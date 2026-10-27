/**
 * Interview workflow service: session setup, one-question-at-a-time state machine,
 * adaptive follow-ups, time limits, post-interview evaluation, retries and audio.
 * All persistence goes through getDb(); callers get explicit success/failure so the
 * UI never claims data was saved when it was not.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  type Category,
  type ExperienceLevel,
  type InterviewMode,
  INTERVIEW_MODES,
  LEVELS,
  RUBRIC_IDS,
  dimensionLabel,
  getConfig,
  isInterviewMode,
  rubricFor,
} from "./config";
import { audioDir, getDb } from "./db";
import { type CandidateContext, type CoachingSummary, type EvaluationResult, type QuestionContext, getAI } from "./ai";
import { type BankQuestion, selectQuestions } from "./questionBank";
import { type OverallScores, dimensionDeltas, overallScores, roundScore, weightedScore, zeroDimensions } from "./scoring";

export class ServiceError extends Error {
  constructor(
    message: string,
    public status: number = 400,
  ) {
    super(message);
  }
}

const now = () => new Date().toISOString();
/** Minimum time per remaining primary question before optional follow-ups are dropped. */
const FOLLOWUP_MIN_MS_PER_REMAINING_QUESTION = 2.5 * 60_000;
const MAX_RESPONSE_CHARS = 20_000;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Row types

export interface SessionRow {
  id: string;
  candidate_id: string;
  role: string;
  experience_level: ExperienceLevel;
  interview_mode: InterviewMode;
  response_mode: "text" | "voice";
  time_limit_minutes: number | null;
  target_job_description: string | null;
  consent_to_audio_recording: number;
  rubric_version: string;
  status: "in_progress" | "evaluating" | "completed" | "evaluation_failed";
  started_at: string;
  deadline_at: string | null;
  completed_at: string | null;
  overall_json: string | null;
  coaching_json: string | null;
  evaluation_error: string | null;
}

interface SessionQuestionRow {
  session_id: string;
  position: number;
  question_id: string;
  question_text: string;
  category: Category;
}

export interface AttemptRow {
  id: string;
  session_id: string;
  question_id: string;
  attempt_number: number;
  kind: "interview" | "retry";
  question_text: string;
  response_text: string;
  response_source: "text" | "audio_transcript" | "none";
  transcript_raw: string | null;
  audio_id: string | null;
  followup_text: string | null;
  followup_trigger: string | null;
  followup_response_text: string | null;
  status: "awaiting_followup" | "submitted" | "skipped" | "not_reached";
  created_at: string;
  submitted_at: string | null;
}

interface EvaluationRow {
  id: string;
  attempt_id: string;
  rubric_id: string;
  category: Category;
  dimension_scores: string;
  weighted_score: number;
  strengths: string;
  improvements: string;
  missing_components: string;
  answer_outline: string;
  confidence: "low" | "medium" | "high";
  evaluator: string;
  created_at: string;
}

interface ComparisonRow {
  retry_attempt_id: string;
  previous_attempt_id: string;
  summary: string;
  specific_changes: string;
  remaining_gaps: string;
}

// ---------------------------------------------------------------------------
// Session setup

export interface CreateSessionInput {
  role?: unknown;
  experience_level?: unknown;
  interview_mode?: unknown;
  response_mode?: unknown;
  time_limit_minutes?: unknown;
  target_job_description?: unknown;
  consent_to_audio_recording?: unknown;
}

export function createSession(candidateId: string, input: CreateSessionInput): SessionRow {
  const cfg = getConfig();
  const defaults = cfg.interview_configuration.defaults;
  if (typeof input.role !== "string" || !cfg.roles.includes(input.role)) throw new ServiceError("Select one of the supported roles.");
  if (!LEVELS.includes(input.experience_level as ExperienceLevel)) throw new ServiceError("Select an experience level: entry, mid or senior.");
  const mode = input.interview_mode ?? defaults.interview_mode;
  if (!isInterviewMode(mode)) throw new ServiceError("Unknown interview type.");
  const responseMode = input.response_mode ?? defaults.response_mode;
  if (responseMode !== "text" && responseMode !== "voice") throw new ServiceError("Response mode must be text or voice.");
  const consent = input.consent_to_audio_recording === true;
  if (responseMode === "voice" && !consent) {
    throw new ServiceError("Voice answers require your consent to record and transcribe audio.");
  }
  let limit: number | null = null;
  if (input.time_limit_minutes !== undefined && input.time_limit_minutes !== null && input.time_limit_minutes !== "") {
    limit = Number(input.time_limit_minutes);
    if (!Number.isInteger(limit) || limit < 5 || limit > 240) throw new ServiceError("Time limit must be 5-240 minutes.");
  }
  const jd = typeof input.target_job_description === "string" ? input.target_job_description.trim().slice(0, 8000) || null : null;

  const questions = selectQuestions(input.role, mode);
  const started = now();
  const row: SessionRow = {
    id: randomUUID(),
    candidate_id: candidateId,
    role: input.role,
    experience_level: input.experience_level as ExperienceLevel,
    interview_mode: mode,
    response_mode: responseMode,
    time_limit_minutes: limit,
    target_job_description: jd,
    consent_to_audio_recording: consent ? 1 : 0,
    rubric_version: cfg.version,
    status: "in_progress",
    started_at: started,
    deadline_at: limit ? new Date(Date.parse(started) + limit * 60_000).toISOString() : null,
    completed_at: null,
    overall_json: null,
    coaching_json: null,
    evaluation_error: null,
  };
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO sessions VALUES (@id,@candidate_id,@role,@experience_level,@interview_mode,@response_mode,@time_limit_minutes,
        @target_job_description,@consent_to_audio_recording,@rubric_version,@status,@started_at,@deadline_at,@completed_at,
        @overall_json,@coaching_json,@evaluation_error)`,
    ).run(row);
    const ins = db.prepare(`INSERT INTO session_questions VALUES (?,?,?,?,?)`);
    questions.forEach((q, i) => ins.run(row.id, i + 1, q.id, q.question, q.category));
  })();
  return row;
}

export function getSession(id: string, candidateId: string): SessionRow | null {
  const row = getDb().prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as SessionRow | undefined;
  return row && row.candidate_id === candidateId ? row : null;
}

export function requireSession(id: string, candidateId: string): SessionRow {
  const s = getSession(id, candidateId);
  if (!s) throw new ServiceError("Interview session not found.", 404);
  return s;
}

function sessionQuestions(sessionId: string): SessionQuestionRow[] {
  return getDb().prepare(`SELECT * FROM session_questions WHERE session_id = ? ORDER BY position`).all(sessionId) as SessionQuestionRow[];
}

function attemptsFor(sessionId: string): AttemptRow[] {
  return getDb()
    .prepare(`SELECT * FROM attempts WHERE session_id = ? ORDER BY question_id, attempt_number`)
    .all(sessionId) as AttemptRow[];
}

function bankQuestion(id: string): BankQuestion {
  const r = getDb().prepare(`SELECT * FROM questions WHERE id = ?`).get(id) as
    | (Omit<BankQuestion, "followup_templates"> & { followup_templates: string })
    | undefined;
  if (!r) throw new ServiceError(`Question ${id} not found in the bank.`, 500);
  return { ...r, followup_templates: JSON.parse(r.followup_templates) };
}

function questionContext(id: string): QuestionContext {
  const q = bankQuestion(id);
  return { id: q.id, category: q.category, question: q.question, competency: q.competency, followup_templates: q.followup_templates };
}

function candidateContext(s: SessionRow): CandidateContext {
  return { role: s.role, level: s.experience_level, targetJobDescription: s.target_job_description };
}

// ---------------------------------------------------------------------------
// Interview state machine (mock interview mode: no scores are exposed here)

export type InterviewStep =
  | { type: "question"; position: number; question_id: string; question_text: string; category: Category }
  | { type: "followup"; position: number; question_id: string; question_text: string; category: Category; followup_text: string; response_text: string }
  | { type: "finished" }
  | { type: "time_up" };

export interface InterviewState {
  session_id: string;
  status: SessionRow["status"];
  role: string;
  experience_level: ExperienceLevel;
  interview_mode: InterviewMode;
  response_mode: "text" | "voice";
  consent_to_audio_recording: boolean;
  deadline_at: string | null;
  total_questions: number;
  answered: number;
  step: InterviewStep;
}

export function getInterviewState(s: SessionRow): InterviewState {
  const qs = sessionQuestions(s.id);
  const firsts = new Map(
    attemptsFor(s.id)
      .filter((a) => a.attempt_number === 1)
      .map((a) => [a.question_id, a]),
  );
  let step: InterviewStep = { type: "finished" };
  let answered = 0;
  for (const q of qs) {
    const a = firsts.get(q.question_id);
    if (!a) {
      step = { type: "question", position: q.position, question_id: q.question_id, question_text: q.question_text, category: q.category };
      break;
    }
    if (a.status === "awaiting_followup") {
      step = {
        type: "followup",
        position: q.position,
        question_id: q.question_id,
        question_text: q.question_text,
        category: q.category,
        followup_text: a.followup_text ?? "",
        response_text: a.response_text,
      };
      break;
    }
    answered++;
  }
  if (step.type !== "finished" && s.deadline_at && Date.now() > Date.parse(s.deadline_at) && s.status === "in_progress") {
    step = { type: "time_up" };
  }
  return {
    session_id: s.id,
    status: s.status,
    role: s.role,
    experience_level: s.experience_level,
    interview_mode: s.interview_mode,
    response_mode: s.response_mode,
    consent_to_audio_recording: !!s.consent_to_audio_recording,
    deadline_at: s.deadline_at,
    total_questions: qs.length,
    answered,
    step,
  };
}

export interface SubmitAnswerInput {
  question_id?: unknown;
  phase?: unknown; // "base" | "followup"
  response_text?: unknown;
  response_source?: unknown;
  transcript_raw?: unknown;
  audio_id?: unknown;
  skip?: unknown;
}

function cleanText(v: unknown): string {
  if (typeof v !== "string") return "";
  if (v.length > MAX_RESPONSE_CHARS) throw new ServiceError(`Responses are limited to ${MAX_RESPONSE_CHARS} characters.`);
  return v;
}

function validateAudio(s: SessionRow, audioId: unknown): string | null {
  if (audioId === undefined || audioId === null || audioId === "") return null;
  if (typeof audioId !== "string") throw new ServiceError("Invalid audio reference.");
  const a = getDb().prepare(`SELECT session_id FROM audio_recordings WHERE id = ?`).get(audioId) as { session_id: string } | undefined;
  if (!a || a.session_id !== s.id) throw new ServiceError("Audio recording not found for this session.");
  return audioId;
}

function followupAllowed(s: SessionRow, remainingAfterThis: number): boolean {
  if (getConfig().adaptive_interview_policy.followups_per_question_max < 1) return false;
  if (!s.deadline_at) return true;
  // Timed interviews: protect the remaining primary questions before asking optional follow-ups.
  const msLeft = Date.parse(s.deadline_at) - Date.now();
  return msLeft > (remainingAfterThis + 1) * FOLLOWUP_MIN_MS_PER_REMAINING_QUESTION;
}

/**
 * Switches between typed and spoken answers mid-interview. Spoken answers record audio,
 * so turning them on requires the candidate's affirmative consent.
 */
export function setResponseMode(s: SessionRow, mode: unknown, consent: unknown): InterviewState {
  if (s.status !== "in_progress") throw new ServiceError("This interview is no longer in progress.", 409);
  if (mode !== "text" && mode !== "voice") throw new ServiceError("Response mode must be text or voice.");
  const consented = mode === "voice" ? consent === true || !!s.consent_to_audio_recording : !!s.consent_to_audio_recording;
  if (mode === "voice" && !consented) throw new ServiceError("Voice answers require your consent to record and transcribe audio.");
  getDb().prepare(`UPDATE sessions SET response_mode = ?, consent_to_audio_recording = ? WHERE id = ?`).run(mode, consented ? 1 : 0, s.id);
  return getInterviewState({ ...s, response_mode: mode, consent_to_audio_recording: consented ? 1 : 0 });
}

export async function submitAnswer(s: SessionRow, input: SubmitAnswerInput): Promise<InterviewState> {
  if (s.status !== "in_progress") throw new ServiceError("This interview is no longer in progress.", 409);
  const state = getInterviewState(s);
  const step = state.step;
  if (step.type !== "question" && step.type !== "followup") {
    throw new ServiceError(step.type === "time_up" ? "Time is up for this interview." : "All questions are answered.", 409);
  }
  if (input.question_id !== step.question_id) throw new ServiceError("That is not the current question.", 409);

  const db = getDb();
  const skip = input.skip === true;
  const text = skip ? "" : cleanText(input.response_text);
  if (!skip && !text.trim()) throw new ServiceError("Please enter a response, or choose Skip.");
  const source = skip ? "none" : input.response_source === "audio_transcript" ? "audio_transcript" : "text";
  const audioId = skip ? null : validateAudio(s, input.audio_id);
  const transcriptRaw = typeof input.transcript_raw === "string" ? input.transcript_raw.slice(0, MAX_RESPONSE_CHARS) : null;

  if (step.type === "followup") {
    if (input.phase !== "followup") throw new ServiceError("A follow-up answer is expected.", 409);
    db.prepare(
      `UPDATE attempts SET followup_response_text = ?, status = 'submitted', submitted_at = ? WHERE session_id = ? AND question_id = ? AND attempt_number = 1`,
    ).run(skip ? "" : text, now(), s.id, step.question_id);
    return getInterviewState(s);
  }

  if (input.phase !== "base") throw new ServiceError("A primary answer is expected.", 409);
  const attemptId = randomUUID();
  db.prepare(
    `INSERT INTO attempts (id, session_id, question_id, attempt_number, kind, question_text, response_text, response_source,
       transcript_raw, audio_id, status, created_at, submitted_at)
     VALUES (?, ?, ?, 1, 'interview', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(attemptId, s.id, step.question_id, step.question_text, text, source, transcriptRaw, audioId, skip ? "skipped" : "submitted", now(), now());

  // The answer is saved. Decide on at most one neutral follow-up; failures never block the interview.
  const remainingAfterThis = state.total_questions - step.position;
  if (!skip && followupAllowed(s, remainingAfterThis)) {
    try {
      const decision = await getAI().decideFollowup(questionContext(step.question_id), candidateContext(s), {
        responseText: text,
        responseSource: source as "text" | "audio_transcript",
      });
      if (decision.needs_followup && decision.followup_question) {
        db.prepare(`UPDATE attempts SET status = 'awaiting_followup', followup_text = ?, followup_trigger = ? WHERE id = ?`).run(
          decision.followup_question.slice(0, 500),
          decision.trigger,
          attemptId,
        );
      }
    } catch (err) {
      console.warn(`[interview] follow-up decision failed for ${step.question_id}; continuing without one:`, err);
    }
  }
  return getInterviewState(s);
}

// ---------------------------------------------------------------------------
// Evaluation

const evaluating = new Set<string>();

function storeEvaluation(attempt: AttemptRow, category: Category, result: EvaluationResult, evaluator: string): number {
  const score = weightedScore(result.dimensions, rubricFor(category));
  getDb()
    .prepare(
      `INSERT INTO evaluations (id, attempt_id, rubric_id, category, dimension_scores, weighted_score, strengths, improvements,
         missing_components, answer_outline, confidence, evaluator, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      randomUUID(),
      attempt.id,
      RUBRIC_IDS[category],
      category,
      JSON.stringify(result.dimensions),
      score,
      JSON.stringify(result.strengths),
      JSON.stringify(result.improvements),
      JSON.stringify(result.missing_components),
      result.answer_outline,
      result.confidence,
      evaluator,
      now(),
    );
  return score;
}

function noResponseEvaluation(category: Category, reason: string): EvaluationResult {
  return {
    dimensions: zeroDimensions(category, reason),
    strengths: [],
    improvements: ["Provide an answer to this question; unanswered questions receive no credit."],
    missing_components: rubricFor(category).map((d) => `${d.label}: no response`),
    answer_outline: rubricFor(category)
      .map((d) => `- **${d.label}:** [your ${d.label.toLowerCase()}]`)
      .join("\n"),
    confidence: "high",
  };
}

async function evaluateAttempt(s: SessionRow, a: AttemptRow): Promise<number> {
  const q = questionContext(a.question_id);
  const hasAnswer = a.status === "submitted" && a.response_text.trim().length > 0;
  if (!hasAnswer) {
    const reason = a.status === "not_reached" ? "Question not reached before the interview ended." : "Question skipped.";
    return storeEvaluation(a, q.category, noResponseEvaluation(q.category, reason), "rule:no-response");
  }
  const ai = getAI();
  const result = await ai.evaluate(q, candidateContext(s), {
    responseText: a.response_text,
    responseSource: a.response_source === "audio_transcript" ? "audio_transcript" : "text",
    followupText: a.followup_text,
    followupResponseText: a.followup_response_text,
  });
  return storeEvaluation(a, q.category, result, ai.name);
}

async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<unknown>): Promise<PromiseSettledResult<unknown>[]> {
  const results: PromiseSettledResult<unknown>[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Ends the interview (marking any unanswered questions as not reached) and evaluates
 * every primary answer. Safe to call again after a failure: only missing evaluations
 * are produced.
 */
export async function completeSession(s: SessionRow): Promise<SessionRow> {
  const db = getDb();
  if (s.status === "completed") return s;
  if (evaluating.has(s.id)) return requireSession(s.id, s.candidate_id);
  evaluating.add(s.id);
  try {
    db.transaction(() => {
      const existing = new Set(attemptsFor(s.id).filter((a) => a.attempt_number === 1).map((a) => a.question_id));
      const ins = db.prepare(
        `INSERT INTO attempts (id, session_id, question_id, attempt_number, kind, question_text, response_text, response_source, status, created_at)
         VALUES (?, ?, ?, 1, 'interview', ?, '', 'none', 'not_reached', ?)`,
      );
      for (const q of sessionQuestions(s.id)) if (!existing.has(q.question_id)) ins.run(randomUUID(), s.id, q.question_id, q.question_text, now());
      // An unanswered follow-up does not block completion; the primary answer is evaluated as-is.
      db.prepare(`UPDATE attempts SET status = 'submitted', submitted_at = COALESCE(submitted_at, ?) WHERE session_id = ? AND status = 'awaiting_followup'`).run(now(), s.id);
      db.prepare(`UPDATE sessions SET status = 'evaluating', completed_at = COALESCE(completed_at, ?), evaluation_error = NULL WHERE id = ?`).run(now(), s.id);
    })();

    const pending = db
      .prepare(
        `SELECT a.* FROM attempts a LEFT JOIN evaluations e ON e.attempt_id = a.id
         WHERE a.session_id = ? AND a.attempt_number = 1 AND e.id IS NULL`,
      )
      .all(s.id) as AttemptRow[];
    const results = await mapLimit(pending, 4, (a) => evaluateAttempt(s, a));
    const failures = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    if (failures.length) {
      throw new Error(`${failures.length} of ${pending.length} answers could not be evaluated: ${String(failures[0].reason?.message ?? failures[0].reason)}`);
    }

    const detail = getSessionDetail(requireSession(s.id, s.candidate_id), { includeScores: true });
    const overall = detail.original;
    const ai = getAI();
    const coaching = await ai.summarize(
      candidateContext(s),
      detail.questions.map((q) => {
        const ev = q.attempts[0].evaluation!;
        return {
          question_id: q.question_id,
          category: q.category,
          competency: q.competency,
          weighted_score: ev.weighted_score,
          dimensions: Object.fromEntries(ev.dimensions.map((d) => [d.key, { score: d.score, gap: d.gap }])),
          missing_components: ev.missing_components,
          improvements: ev.improvements,
        };
      }),
    );
    db.prepare(`UPDATE sessions SET status = 'completed', overall_json = ?, coaching_json = ?, evaluation_error = NULL WHERE id = ?`).run(
      JSON.stringify(overall),
      JSON.stringify({ ...coaching, generated_by: ai.name }),
      s.id,
    );
  } catch (err) {
    console.error(`[interview] evaluation failed for session ${s.id}:`, err);
    db.prepare(`UPDATE sessions SET status = 'evaluation_failed', evaluation_error = ? WHERE id = ?`).run(
      err instanceof Error ? err.message : String(err),
      s.id,
    );
  } finally {
    evaluating.delete(s.id);
  }
  return requireSession(s.id, s.candidate_id);
}

// ---------------------------------------------------------------------------
// Retries (coaching mode, after the interview). Each retry is a NEW attempt row;
// earlier attempts are immutable and keep their own evaluations.

export interface RetryInput {
  question_id?: unknown;
  response_text?: unknown;
  response_source?: unknown;
  transcript_raw?: unknown;
  audio_id?: unknown;
}

export async function retryQuestion(s: SessionRow, input: RetryInput): Promise<{ attempt_id: string; evaluated: boolean; error?: string }> {
  if (s.status !== "completed") throw new ServiceError("Retries open after the interview has been evaluated.", 409);
  const sq = sessionQuestions(s.id).find((q) => q.question_id === input.question_id);
  if (!sq) throw new ServiceError("That question is not part of this interview.");
  const text = cleanText(input.response_text);
  if (!text.trim()) throw new ServiceError("Please enter your revised answer.");
  const limit = getConfig().retry_and_coaching.retry_limit;
  const db = getDb();
  const { n } = db.prepare(`SELECT MAX(attempt_number) AS n FROM attempts WHERE session_id = ? AND question_id = ?`).get(s.id, sq.question_id) as { n: number };
  if (limit !== null && n - 1 >= limit) throw new ServiceError(`The retry limit (${limit}) has been reached for this question.`, 409);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO attempts (id, session_id, question_id, attempt_number, kind, question_text, response_text, response_source,
       transcript_raw, audio_id, status, created_at, submitted_at)
     VALUES (?, ?, ?, ?, 'retry', ?, ?, ?, ?, ?, 'submitted', ?, ?)`,
  ).run(
    id,
    s.id,
    sq.question_id,
    n + 1,
    sq.question_text,
    text,
    input.response_source === "audio_transcript" ? "audio_transcript" : "text",
    typeof input.transcript_raw === "string" ? input.transcript_raw.slice(0, MAX_RESPONSE_CHARS) : null,
    validateAudio(s, input.audio_id),
    now(),
    now(),
  );
  try {
    await evaluateRetry(s, id);
    return { attempt_id: id, evaluated: true };
  } catch (err) {
    console.error(`[interview] retry evaluation failed for attempt ${id}:`, err);
    return { attempt_id: id, evaluated: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Evaluates a retry attempt (if not yet evaluated) and compares it with the previous attempt. */
export async function evaluateRetry(s: SessionRow, attemptId: string): Promise<void> {
  const db = getDb();
  const a = db.prepare(`SELECT * FROM attempts WHERE id = ? AND session_id = ?`).get(attemptId, s.id) as AttemptRow | undefined;
  if (!a || a.kind !== "retry") throw new ServiceError("Retry attempt not found.", 404);
  const hasEval = db.prepare(`SELECT 1 FROM evaluations WHERE attempt_id = ?`).get(a.id);
  if (!hasEval) await evaluateAttempt(s, a);
  if (db.prepare(`SELECT 1 FROM attempt_comparisons WHERE retry_attempt_id = ?`).get(a.id)) return;

  const prev = db
    .prepare(`SELECT * FROM attempts WHERE session_id = ? AND question_id = ? AND attempt_number = ?`)
    .get(s.id, a.question_id, a.attempt_number - 1) as AttemptRow;
  const prevEval = loadEvaluation(prev.id);
  const curEval = loadEvaluation(a.id);
  if (!prevEval || !curEval) return;
  const cmp = await getAI().compare(
    questionContext(a.question_id),
    candidateContext(s),
    { response: prev.response_text, evaluation: prevEval.result, score: prevEval.score },
    { response: a.response_text, evaluation: curEval.result, score: curEval.score },
  );
  db.prepare(`INSERT INTO attempt_comparisons VALUES (?, ?, ?, ?, ?, ?)`).run(
    a.id,
    prev.id,
    cmp.summary,
    JSON.stringify(cmp.specific_changes),
    JSON.stringify(cmp.remaining_gaps),
    now(),
  );
}

function loadEvaluation(attemptId: string): { result: EvaluationResult; score: number; row: EvaluationRow } | null {
  const row = getDb().prepare(`SELECT * FROM evaluations WHERE attempt_id = ?`).get(attemptId) as EvaluationRow | undefined;
  if (!row) return null;
  return {
    row,
    score: row.weighted_score,
    result: {
      dimensions: JSON.parse(row.dimension_scores),
      strengths: JSON.parse(row.strengths),
      improvements: JSON.parse(row.improvements),
      missing_components: JSON.parse(row.missing_components),
      answer_outline: row.answer_outline,
      confidence: row.confidence,
    },
  };
}

// ---------------------------------------------------------------------------
// Read models for results, dashboard and reports

export interface DimensionView {
  key: string;
  label: string;
  weight: number;
  score: number;
  evidence: string;
  gap: string | null;
  actionable_tip: string;
}

export interface EvaluationView {
  rubric_id: string;
  category: Category;
  dimensions: DimensionView[];
  weighted_score: number;
  weighted_score_raw: number;
  strengths: string[];
  improvements: string[];
  missing_components: string[];
  answer_outline: string;
  confidence: "low" | "medium" | "high";
  evaluator: string;
}

export interface AttemptView {
  id: string;
  attempt_number: number;
  kind: "interview" | "retry";
  response_text: string;
  response_source: AttemptRow["response_source"];
  transcript_raw: string | null;
  audio_uri: string | null;
  followup_text: string | null;
  followup_response_text: string | null;
  status: AttemptRow["status"];
  created_at: string;
  submitted_at: string | null;
  evaluation: EvaluationView | null;
  comparison: {
    previous_attempt_number: number;
    summary: string;
    specific_changes: string[];
    remaining_gaps: string[];
    deltas: { key: string; label: string; before: number; after: number; delta: number }[];
    score_before: number;
    score_after: number;
  } | null;
}

export interface QuestionView {
  position: number;
  question_id: string;
  category: Category;
  competency: string;
  question_text: string;
  attempts: AttemptView[];
}

export interface SessionDetail {
  session: Omit<SessionRow, "overall_json" | "coaching_json" | "candidate_id"> & { mode_label: string };
  questions: QuestionView[];
  /** Scores from the original interview answers (attempt 1). */
  original: OverallScores | null;
  /** Scores using each question's latest evaluated attempt (retries included). */
  latest: OverallScores | null;
  category_dimension_averages: Record<Category, { key: string; label: string; weight: number; average: number }[]>;
  coaching: (CoachingSummary & { generated_by?: string }) | null;
}

function toEvaluationView(row: EvaluationRow): EvaluationView {
  const dims = JSON.parse(row.dimension_scores) as Record<string, Omit<DimensionView, "key" | "label" | "weight">>;
  return {
    rubric_id: row.rubric_id,
    category: row.category,
    dimensions: rubricFor(row.category).map((d) => ({ key: d.key, label: d.label, weight: d.weight, ...dims[d.key] })),
    weighted_score: roundScore(row.weighted_score),
    weighted_score_raw: row.weighted_score,
    strengths: JSON.parse(row.strengths),
    improvements: JSON.parse(row.improvements),
    missing_components: JSON.parse(row.missing_components),
    answer_outline: row.answer_outline,
    confidence: row.confidence,
    evaluator: row.evaluator,
  };
}

export function getSessionDetail(s: SessionRow, opts: { includeScores?: boolean } = {}): SessionDetail {
  const db = getDb();
  const evals = new Map(
    (db.prepare(`SELECT e.* FROM evaluations e JOIN attempts a ON a.id = e.attempt_id WHERE a.session_id = ?`).all(s.id) as EvaluationRow[]).map(
      (e) => [e.attempt_id, e],
    ),
  );
  const comps = new Map(
    (
      db.prepare(`SELECT c.* FROM attempt_comparisons c JOIN attempts a ON a.id = c.retry_attempt_id WHERE a.session_id = ?`).all(s.id) as ComparisonRow[]
    ).map((c) => [c.retry_attempt_id, c]),
  );
  const all = attemptsFor(s.id);
  // Mock interview mode: evaluations stay hidden from the candidate until the interview is finished.
  const showScores = opts.includeScores || s.status === "completed" || s.status === "evaluation_failed";

  const questions: QuestionView[] = sessionQuestions(s.id).map((q) => {
    const bq = bankQuestion(q.question_id);
    const attempts = all.filter((a) => a.question_id === q.question_id);
    const views: AttemptView[] = attempts.map((a) => {
      const e = showScores ? evals.get(a.id) : undefined;
      const c = showScores ? comps.get(a.id) : undefined;
      const prev = c ? attempts.find((p) => p.id === c.previous_attempt_id) : undefined;
      const prevEval = prev ? evals.get(prev.id) : undefined;
      return {
        id: a.id,
        attempt_number: a.attempt_number,
        kind: a.kind,
        response_text: a.response_text,
        response_source: a.response_source,
        transcript_raw: a.transcript_raw,
        audio_uri: a.audio_id ? `/api/audio/${a.audio_id}` : null,
        followup_text: a.followup_text,
        followup_response_text: a.followup_response_text,
        status: a.status,
        created_at: a.created_at,
        submitted_at: a.submitted_at,
        evaluation: e ? toEvaluationView(e) : null,
        comparison:
          c && e && prev && prevEval
            ? {
                previous_attempt_number: prev.attempt_number,
                summary: c.summary,
                specific_changes: JSON.parse(c.specific_changes),
                remaining_gaps: JSON.parse(c.remaining_gaps),
                deltas: dimensionDeltas(JSON.parse(prevEval.dimension_scores), JSON.parse(e.dimension_scores), rubricFor(q.category)),
                score_before: roundScore(prevEval.weighted_score),
                score_after: roundScore(e.weighted_score),
              }
            : null,
      };
    });
    return { position: q.position, question_id: q.question_id, category: q.category, competency: bq.competency, question_text: q.question_text, attempts: views };
  });

  const originalScores = questions.flatMap((q) => {
    const ev = q.attempts.find((a) => a.attempt_number === 1)?.evaluation;
    return ev ? [{ question_id: q.question_id, category: q.category, weighted_score: ev.weighted_score_raw }] : [];
  });
  const latestScores = questions.flatMap((q) => {
    const ev = [...q.attempts].reverse().find((a) => a.evaluation)?.evaluation;
    return ev ? [{ question_id: q.question_id, category: q.category, weighted_score: ev.weighted_score_raw }] : [];
  });
  const complete = originalScores.length === questions.length && questions.length > 0;

  const cats = INTERVIEW_MODES[s.interview_mode].categories as readonly Category[];
  const category_dimension_averages = Object.fromEntries(
    (["behavioral", "technical_knowledge", "technical_scenario"] as Category[]).map((cat) => {
      const evs = questions.filter((q) => q.category === cat).flatMap((q) => q.attempts.find((a) => a.attempt_number === 1)?.evaluation ?? []);
      return [
        cat,
        cats.includes(cat) && evs.length
          ? rubricFor(cat).map((d) => ({
              key: d.key,
              label: dimensionLabel(d.key),
              weight: d.weight,
              average: roundScore(evs.reduce((sum, ev) => sum + (ev.dimensions.find((x) => x.key === d.key)?.score ?? 0), 0) / evs.length),
            }))
          : [],
      ];
    }),
  ) as SessionDetail["category_dimension_averages"];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { overall_json, coaching_json, candidate_id, ...session } = s;
  return {
    session: { ...session, mode_label: INTERVIEW_MODES[s.interview_mode].label },
    questions,
    original: showScores && complete ? overallScores(originalScores) : null,
    latest: showScores && complete ? overallScores(latestScores) : null,
    category_dimension_averages,
    coaching: showScores && coaching_json ? JSON.parse(coaching_json) : null,
  };
}

export function listSessions(candidateId: string): SessionRow[] {
  return getDb().prepare(`SELECT * FROM sessions WHERE candidate_id = ? ORDER BY started_at DESC`).all(candidateId) as SessionRow[];
}

export function deleteSession(s: SessionRow): void {
  const db = getDb();
  const files = db.prepare(`SELECT file_path FROM audio_recordings WHERE session_id = ?`).all(s.id) as { file_path: string }[];
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(s.id);
  for (const f of files) fs.rmSync(f.file_path, { force: true });
}

// ---------------------------------------------------------------------------
// Audio (only with affirmative consent; stored outside the web root, served only to its owner)

const AUDIO_TYPES: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav" };

export function saveAudio(s: SessionRow, data: Buffer, mimeType: string): { id: string; uri: string } {
  if (!s.consent_to_audio_recording) throw new ServiceError("Audio recording requires consent for this interview.", 403);
  if (s.status === "evaluating") throw new ServiceError("This interview is being evaluated.", 409);
  const base = mimeType.split(";")[0].trim().toLowerCase();
  const ext = AUDIO_TYPES[base];
  if (!ext) throw new ServiceError(`Unsupported audio type ${mimeType}.`);
  if (data.length === 0) throw new ServiceError("The recording is empty.");
  if (data.length > MAX_AUDIO_BYTES) throw new ServiceError("The recording is too large.");
  const id = randomUUID();
  // Runtime storage location, not a build input.
  const dir = path.join(/*turbopackIgnore: true*/ audioDir(), s.id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(/*turbopackIgnore: true*/ dir, `${id}.${ext}`);
  fs.writeFileSync(file, data);
  try {
    getDb().prepare(`INSERT INTO audio_recordings VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, s.candidate_id, s.id, base, file, data.length, now());
  } catch (err) {
    fs.rmSync(file, { force: true });
    throw err;
  }
  return { id, uri: `/api/audio/${id}` };
}

export function getAudio(id: string, candidateId: string): { mime_type: string; data: Buffer } | null {
  const r = getDb().prepare(`SELECT * FROM audio_recordings WHERE id = ?`).get(id) as
    | { candidate_id: string; mime_type: string; file_path: string }
    | undefined;
  if (!r || r.candidate_id !== candidateId || !fs.existsSync(r.file_path)) return null;
  return { mime_type: r.mime_type, data: fs.readFileSync(r.file_path) };
}
