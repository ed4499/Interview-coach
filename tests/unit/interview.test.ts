import fs from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  completeSession,
  createSession,
  deleteSession,
  getAudio,
  getInterviewState,
  getSessionDetail,
  requireSession,
  retryQuestion,
  saveAudio,
  submitAnswer,
} from "@/lib/interview";
import { getProgress } from "@/lib/progress";
import { reportFilename, reportPdf } from "@/lib/report";
import { ScriptedAI, freshEnv } from "./helpers";
import type Database from "better-sqlite3";

const CANDIDATE = "cand-1";
let db: Database.Database;
let ai: ScriptedAI;

beforeEach(() => {
  ({ db, ai } = freshEnv());
});

async function answerAll(sessionId: string, text = (qid: string) => `When I worked the help desk I was asked to fix ${qid}. I checked logs and resolved it.`) {
  for (;;) {
    const s = requireSession(sessionId, CANDIDATE);
    const st = getInterviewState(s);
    if (st.step.type === "question") await submitAnswer(s, { question_id: st.step.question_id, phase: "base", response_text: text(st.step.question_id) });
    else if (st.step.type === "followup") await submitAnswer(s, { question_id: st.step.question_id, phase: "followup", response_text: "My follow-up detail." });
    else return st;
  }
}

describe("session setup", () => {
  it("requires a supported role and experience level", () => {
    expect(() => createSession(CANDIDATE, { role: "Astronaut", experience_level: "mid" })).toThrow(/role/);
    expect(() => createSession(CANDIDATE, { role: "IT Support", experience_level: "expert" })).toThrow(/level/);
  });

  it("requires affirmative consent for voice answers", () => {
    expect(() => createSession(CANDIDATE, { role: "IT Support", experience_level: "mid", response_mode: "voice" })).toThrow(/consent/);
    expect(createSession(CANDIDATE, { role: "IT Support", experience_level: "mid", response_mode: "voice", consent_to_audio_recording: true }).consent_to_audio_recording).toBe(1);
  });

  it("assigns the exact role-specific questions for each interview type", () => {
    const counts = { full: 15, behavioral_only: 5, technical_knowledge_only: 5, technical_scenario_only: 5, technical_only: 10 };
    for (const [mode, n] of Object.entries(counts)) {
      const s = createSession(CANDIDATE, { role: "SOC Analyst", experience_level: "entry", interview_mode: mode });
      const rows = db.prepare(`SELECT sq.question_id, q.role FROM session_questions sq JOIN questions q ON q.id = sq.question_id WHERE session_id = ?`).all(s.id) as { role: string }[];
      expect(rows).toHaveLength(n);
      expect(rows.every((r) => r.role === "SOC Analyst")).toBe(true);
      expect(getInterviewState(s).total_questions).toBe(n);
    }
  });
});

describe("interview flow", () => {
  it("asks one question at a time, in order, and saves each response with session, role and level", async () => {
    const s = createSession(CANDIDATE, { role: "Network Engineer", experience_level: "senior" });
    const st = getInterviewState(s);
    expect(st.step.type).toBe("question");
    if (st.step.type !== "question") return;
    expect(st.step.question_id).toBe("03-B01");
    await expect(submitAnswer(s, { question_id: "03-B02", phase: "base", response_text: "x" })).rejects.toThrow(/current question/);
    await submitAnswer(s, { question_id: "03-B01", phase: "base", response_text: "  Verbatim answer, with   spacing.\nLine 2  " });
    const row = db
      .prepare(`SELECT a.*, s.role, s.experience_level FROM attempts a JOIN sessions s ON s.id = a.session_id WHERE a.session_id = ?`)
      .get(s.id) as Record<string, unknown>;
    expect(row).toMatchObject({ question_id: "03-B01", role: "Network Engineer", experience_level: "senior", attempt_number: 1, kind: "interview" });
    expect(row.response_text).toBe("  Verbatim answer, with   spacing.\nLine 2  ");
    expect(row.question_text).toBe(st.step.question_text);
  });

  it("asks at most one follow-up, which never replaces the primary questions", async () => {
    const s = createSession(CANDIDATE, { role: "IT Support", experience_level: "mid" });
    ai.followupFor.add("01-B01");
    const st = await submitAnswer(s, { question_id: "01-B01", phase: "base", response_text: "Short answer." });
    expect(st.step).toMatchObject({ type: "followup", question_id: "01-B01", followup_text: "What specifically was your responsibility?" });
    const after = await submitAnswer(s, { question_id: "01-B01", phase: "followup", response_text: "I owned the ticket." });
    expect(after.step).toMatchObject({ type: "question", question_id: "01-B02" });
    const done = await answerAll(s.id);
    expect(done.step.type).toBe("finished");
    expect(done.answered).toBe(15);
    expect(db.prepare(`SELECT COUNT(*) n FROM attempts WHERE session_id = ?`).get(s.id)).toEqual({ n: 15 });
  });

  it("continues without a follow-up if the follow-up decision fails", async () => {
    const s = createSession(CANDIDATE, { role: "IT Support", experience_level: "mid" });
    ai.decideFollowup = async () => {
      throw new Error("network down");
    };
    const st = await submitAnswer(s, { question_id: "01-B01", phase: "base", response_text: "Answer." });
    expect(st.step).toMatchObject({ type: "question", question_id: "01-B02" });
  });

  it("drops optional follow-ups when a timed interview runs short", async () => {
    const s = createSession(CANDIDATE, { role: "IT Support", experience_level: "mid", time_limit_minutes: 5 });
    ai.followupFor.add("01-B01");
    const st = await submitAnswer(s, { question_id: "01-B01", phase: "base", response_text: "Answer." });
    expect(st.step.type).toBe("question");
    expect(ai.calls.followup).toBe(0);
  });

  it("does not expose any evaluation while the interview is in progress", async () => {
    const s = createSession(CANDIDATE, { role: "IT Support", experience_level: "mid" });
    await submitAnswer(s, { question_id: "01-B01", phase: "base", response_text: "Answer." });
    const d = getSessionDetail(requireSession(s.id, CANDIDATE));
    expect(d.original).toBeNull();
    expect(d.coaching).toBeNull();
    expect(d.questions.every((q) => q.attempts.every((a) => a.evaluation === null))).toBe(true);
    expect(ai.calls.evaluate).toBe(0);
  });
});

describe("evaluation", () => {
  it("gives behavioral answers STAR evaluations and technical answers technical evaluations", async () => {
    const s = createSession(CANDIDATE, { role: "Cloud Infrastructure Engineer", experience_level: "mid" });
    await answerAll(s.id);
    const done = await completeSession(requireSession(s.id, CANDIDATE));
    expect(done.status).toBe("completed");
    const d = getSessionDetail(done);
    for (const q of d.questions) {
      const ev = q.attempts[0].evaluation!;
      const keys = ev.dimensions.map((x) => x.key);
      if (q.category === "behavioral") {
        expect(ev.rubric_id).toBe("star_v3");
        expect(keys).toEqual(["situation", "task", "action", "result"]);
        expect(ev.weighted_score_raw).toBeCloseTo(80 * 0.2 + 60 * 0.2 + 50 * 0.4 + 40 * 0.2);
      } else if (q.category === "technical_knowledge") {
        expect(ev.rubric_id).toBe("technical_v3");
        expect(keys).toEqual(["accuracy", "reasoning", "completeness", "communication"]);
        expect(ev.weighted_score_raw).toBeCloseTo(70 * 0.4 + 60 * 0.25 + 50 * 0.2 + 90 * 0.15);
      } else {
        expect(ev.rubric_id).toBe("scenario_v3");
        expect(keys).toEqual(["problem_framing", "proposed_actions", "validation_and_outcome", "communication_and_risk"]);
        expect(ev.weighted_score_raw).toBeCloseTo(60 * 0.2 + 80 * 0.35 + 40 * 0.25 + 70 * 0.2);
      }
    }
    // behavioral 56, technical 66.5, scenario 64 -> overall mean of 15 = 62.17 -> 62
    expect(d.original).toMatchObject({ behavioral_average: 56, technical_knowledge_average: 67, technical_scenario_average: 64, overall_score: 62, readiness_band: "Developing" });
    expect(d.coaching!.coaching_actions).toHaveLength(3);
    expect(ai.calls.evaluate).toBe(15);
  });

  it("scores skipped and unreached questions 0 without calling the AI", async () => {
    const s = createSession(CANDIDATE, { role: "Data Analyst", experience_level: "entry", interview_mode: "behavioral_only" });
    await submitAnswer(s, { question_id: "15-B01", phase: "base", response_text: "Answer" });
    await submitAnswer(s, { question_id: "15-B02", phase: "base", skip: true });
    const done = await completeSession(requireSession(s.id, CANDIDATE)); // ended early: B03-B05 not reached
    const d = getSessionDetail(done);
    expect(d.questions.map((q) => q.attempts[0].status)).toEqual(["submitted", "skipped", "not_reached", "not_reached", "not_reached"]);
    expect(d.questions.slice(1).every((q) => q.attempts[0].evaluation!.weighted_score === 0)).toBe(true);
    expect(ai.calls.evaluate).toBe(1);
    expect(d.original!.overall_score).toBe(Math.round(56 / 5));
  });

  it("marks a failed evaluation as retryable and only re-evaluates what is missing", async () => {
    const s = createSession(CANDIDATE, { role: "Pen Tester", experience_level: "mid", interview_mode: "behavioral_only" });
    await answerAll(s.id);
    ai.failEvaluateFor.add("11-B03");
    const failed = await completeSession(requireSession(s.id, CANDIDATE));
    expect(failed.status).toBe("evaluation_failed");
    expect(failed.evaluation_error).toMatch(/1 of 5/);
    expect(getSessionDetail(failed).original).toBeNull();
    ai.failEvaluateFor.clear();
    const before = ai.calls.evaluate;
    const ok = await completeSession(requireSession(s.id, CANDIDATE));
    expect(ok.status).toBe("completed");
    expect(ai.calls.evaluate - before).toBe(1);
  });
});

describe("retries", () => {
  async function completed() {
    const s = createSession(CANDIDATE, { role: "IAM Engineer", experience_level: "mid", interview_mode: "behavioral_only" });
    await answerAll(s.id);
    return completeSession(requireSession(s.id, CANDIDATE));
  }

  it("stores retries as new attempts and never overwrites the original", async () => {
    const s = await completed();
    const original = db.prepare(`SELECT * FROM attempts WHERE session_id = ? AND question_id = '12-B01'`).get(s.id) as Record<string, unknown>;
    const r1 = await retryQuestion(s, { question_id: "12-B01", response_text: "IMPROVED answer with a result." });
    const r2 = await retryQuestion(s, { question_id: "12-B01", response_text: "IMPROVED again." });
    expect(r1.evaluated && r2.evaluated).toBe(true);
    const rows = db.prepare(`SELECT * FROM attempts WHERE session_id = ? AND question_id = '12-B01' ORDER BY attempt_number`).all(s.id) as Record<string, unknown>[];
    expect(rows.map((r) => r.attempt_number)).toEqual([1, 2, 3]);
    expect(rows[0]).toEqual(original);

    const q = getSessionDetail(s).questions[0];
    expect(q.attempts[0].evaluation!.weighted_score).toBe(56);
    expect(q.attempts[1].evaluation!.weighted_score).toBe(76);
    expect(q.attempts[1].comparison).toMatchObject({ previous_attempt_number: 1, score_before: 56, score_after: 76, summary: "Added a measurable result." });
    expect(q.attempts[1].comparison!.deltas.map((x) => x.delta)).toEqual([20, 20, 20, 20]);
    expect(getSessionDetail(s).original!.overall_score).toBe(56);
    expect(getSessionDetail(s).latest!.overall_score).toBe(60); // (76 + 56*4)/5
  });

  it("rejects any attempt to modify a saved response at the database level", async () => {
    const s = await completed();
    expect(() => db.prepare(`UPDATE attempts SET response_text = 'tampered' WHERE session_id = ?`).run(s.id)).toThrow(/immutable/);
  });

  it("keeps a retry whose scoring failed and can score it later", async () => {
    const s = await completed();
    ai.failEvaluateFor.add("12-B02");
    const r = await retryQuestion(s, { question_id: "12-B02", response_text: "IMPROVED" });
    expect(r).toMatchObject({ evaluated: false });
    expect(db.prepare(`SELECT response_text FROM attempts WHERE id = ?`).get(r.attempt_id)).toEqual({ response_text: "IMPROVED" });
  });

  it("only allows retries after evaluation", async () => {
    const s = createSession(CANDIDATE, { role: "IAM Engineer", experience_level: "mid" });
    await expect(retryQuestion(s, { question_id: "12-B01", response_text: "x" })).rejects.toThrow(/after the interview/);
  });
});

describe("audio recordings", () => {
  it("saves consented recordings, links them to the answer, and restricts access to the owner", async () => {
    const s = createSession(CANDIDATE, { role: "Help Desk", experience_level: "entry", response_mode: "voice", consent_to_audio_recording: true });
    const audio = saveAudio(s, Buffer.from("fake-webm-bytes"), "audio/webm;codecs=opus");
    await submitAnswer(s, { question_id: "02-B01", phase: "base", response_text: "Spoken transcript", response_source: "audio_transcript", transcript_raw: "spoken transcript", audio_id: audio.id });
    const a = getSessionDetail(requireSession(s.id, CANDIDATE)).questions[0].attempts[0];
    expect(a).toMatchObject({ response_source: "audio_transcript", transcript_raw: "spoken transcript", audio_uri: `/api/audio/${audio.id}` });
    expect(getAudio(audio.id, CANDIDATE)!.data.toString()).toBe("fake-webm-bytes");
    expect(getAudio(audio.id, "someone-else")).toBeNull();
  });

  it("refuses recordings without consent and rejects foreign audio ids", async () => {
    const s = createSession(CANDIDATE, { role: "Help Desk", experience_level: "entry" });
    expect(() => saveAudio(s, Buffer.from("x"), "audio/webm")).toThrow(/consent/);
    await expect(submitAnswer(s, { question_id: "02-B01", phase: "base", response_text: "x", audio_id: "nope" })).rejects.toThrow(/Audio recording not found/);
  });
});

describe("history, progress, reports and deletion", () => {
  it("tracks sessions, comparison groups and retry improvement", async () => {
    for (let i = 0; i < 2; i++) {
      const s = createSession(CANDIDATE, { role: "IT Manager", experience_level: "senior", interview_mode: "behavioral_only" });
      await answerAll(s.id);
      await completeSession(requireSession(s.id, CANDIDATE));
    }
    const other = createSession(CANDIDATE, { role: "IT Manager", experience_level: "mid", interview_mode: "technical_knowledge_only" });
    await answerAll(other.id);
    const done = await completeSession(requireSession(other.id, CANDIDATE));
    await retryQuestion(done, { question_id: "16-T01", response_text: "IMPROVED" });
    createSession("cand-2", { role: "IT Manager", experience_level: "senior" });

    const p = getProgress(CANDIDATE);
    expect(p.interview_count).toBe(3);
    expect(p.completed_count).toBe(3);
    expect(p.groups.map((g) => [g.key, g.sessions.length]).sort()).toEqual([
      ["IT Manager|mid|3.0", 1],
      ["IT Manager|senior|3.0", 2],
    ]);
    expect(p.sessions.filter((x) => x.star).every((x) => x.star!.action === 50)).toBe(true);
    // technical 66.5 -> 85 (communication caps at 100): rounded 67 -> 85
    expect(p.retry_improvement).toEqual({ retries: 1, average_delta: 18, best_delta: 18 });
    expect(p.technical_skill_gaps[0]).toMatchObject({ dimension: "Completeness", average: 50 });
    expect(p.role_and_level_history).toHaveLength(2);
    expect(p.recommendations.length).toBeGreaterThanOrEqual(3);
  });

  it("renders the PDF report with the stored scores and coaching feedback", async () => {
    const s = createSession(CANDIDATE, { role: "GRC Specialist", experience_level: "mid", interview_mode: "behavioral_only" });
    await answerAll(s.id, () => "Answer with <b>markup</b> and a → arrow inside");
    const done = await completeSession(requireSession(s.id, CANDIDATE));
    await retryQuestion(done, { question_id: "13-B01", response_text: "IMPROVED" });
    const d = getSessionDetail(done);
    const pdf = await reportPdf(d, getProgress(CANDIDATE).sessions, { compress: false });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // Uncompressed pdfkit text is written as hex strings inside TJ operators; decode them.
    const text = [...pdf.toString("latin1").matchAll(/<([0-9a-f]+)>/gi)].map((m) => Buffer.from(m[1], "hex").toString("latin1")).join("");
    for (const expected of ["GRC Specialist Interview Report", "Developing", "Action 1", "Situation", "56 -> 76", "Top three improvement priorities", "Your original answer", "Retry #1", "How to structure a stronger answer"]) {
      expect(text, expected).toContain(expected);
    }
    expect(text).toContain("Answer with <b>markup</b> and a -> arrow inside");
    expect(reportFilename(d)).toMatch(/^interview-report-grc-specialist-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("deletes a session with its answers, evaluations and recordings", async () => {
    const s = createSession(CANDIDATE, { role: "Help Desk", experience_level: "entry", response_mode: "voice", consent_to_audio_recording: true, interview_mode: "behavioral_only" });
    const audio = saveAudio(s, Buffer.from("abc"), "audio/webm");
    const file = (db.prepare(`SELECT file_path FROM audio_recordings WHERE id = ?`).get(audio.id) as { file_path: string }).file_path;
    await answerAll(s.id);
    await completeSession(requireSession(s.id, CANDIDATE));
    deleteSession(requireSession(s.id, CANDIDATE));
    for (const t of ["sessions", "attempts", "evaluations", "audio_recordings", "session_questions"]) {
      expect(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get(), t).toEqual({ n: 0 });
    }
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("switching answer mode mid-interview", () => {
  it("turns on spoken answers only with consent, keeping earlier answers", async () => {
    const { setResponseMode } = await import("@/lib/interview");
    const s = createSession(CANDIDATE, { role: "IT Support", experience_level: "mid" });
    await submitAnswer(s, { question_id: "01-B01", phase: "base", response_text: "Typed answer." });
    expect(() => setResponseMode(requireSession(s.id, CANDIDATE), "voice", false)).toThrow(/consent/);
    const st = setResponseMode(requireSession(s.id, CANDIDATE), "voice", true);
    expect(st.response_mode).toBe("voice");
    expect(st.consent_to_audio_recording).toBe(true);
    const updated = requireSession(s.id, CANDIDATE);
    expect(updated.response_mode).toBe("voice");
    expect(() => saveAudio(updated, Buffer.from("x"), "audio/webm")).not.toThrow();
    expect(getSessionDetail(updated).questions[0].attempts[0].response_text).toBe("Typed answer.");
    expect(setResponseMode(updated, "text", undefined).response_mode).toBe("text");
  });
});
