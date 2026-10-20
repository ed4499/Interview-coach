import type { Category, ExperienceLevel } from "../config";
import type { DimensionScore } from "../scoring";

export interface QuestionContext {
  id: string;
  category: Category;
  question: string;
  competency: string;
  followup_templates: string[];
}

export interface CandidateContext {
  role: string;
  level: ExperienceLevel;
  targetJobDescription?: string | null;
}

export interface AnswerInput {
  responseText: string;
  /** "audio_transcript" answers may contain speech-to-text errors; never penalize them. */
  responseSource: "text" | "audio_transcript";
  followupText?: string | null;
  followupResponseText?: string | null;
}

export interface FollowupDecision {
  needs_followup: boolean;
  trigger: string | null;
  followup_question: string | null;
}

export interface EvaluationResult {
  dimensions: Record<string, DimensionScore>;
  strengths: string[];
  improvements: string[];
  missing_components: string[];
  answer_outline: string;
  confidence: "low" | "medium" | "high";
}

export interface QuestionSummaryInput {
  question_id: string;
  category: Category;
  competency: string;
  weighted_score: number;
  dimensions: Record<string, { score: number; gap: string | null }>;
  missing_components: string[];
  improvements: string[];
}

export interface CoachingAction {
  priority: number;
  title: string;
  detail: string;
  related_question_ids: string[];
}

export interface CoachingSummary {
  coaching_actions: CoachingAction[];
  overall_notes: string;
}

export interface AttemptComparison {
  summary: string;
  specific_changes: string[];
  remaining_gaps: string[];
}

export interface InterviewAI {
  /** Identifier stored with every evaluation, e.g. "anthropic:claude-opus-5-5" or "test-mode". */
  readonly name: string;
  decideFollowup(q: QuestionContext, c: CandidateContext, a: AnswerInput): Promise<FollowupDecision>;
  evaluate(q: QuestionContext, c: CandidateContext, a: AnswerInput): Promise<EvaluationResult>;
  summarize(c: CandidateContext, questions: QuestionSummaryInput[]): Promise<CoachingSummary>;
  compare(
    q: QuestionContext,
    c: CandidateContext,
    previous: { response: string; evaluation: EvaluationResult; score: number },
    revised: { response: string; evaluation: EvaluationResult; score: number },
  ): Promise<AttemptComparison>;
}

export class AIUnavailableError extends Error {}
