/**
 * Deterministic score math. The model only proposes per-dimension scores (0-100)
 * with evidence; weights, rounding, averages and readiness bands are computed here
 * so results are reproducible and match the configuration exactly.
 *
 * Config: "weighted_score=sum(dimension_score*weight/100); round once at final score;
 * missing evidence scores 0, not invented evidence".
 */
import { type Category, type RubricDimension, readinessBand, rubricFor } from "./config";

export interface DimensionScore {
  score: number;
  evidence: string;
  gap: string | null;
  actionable_tip: string;
}

/** Unrounded weighted score. Missing dimensions count as 0. */
export function weightedScore(dimensions: Record<string, { score: number }>, rubric: RubricDimension[]): number {
  return rubric.reduce((sum, d) => sum + clampScore(dimensions[d.key]?.score ?? 0) * (d.weight / 100), 0);
}

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function roundScore(n: number): number {
  return Math.round(n);
}

export interface QuestionScore {
  question_id: string;
  category: Category;
  /** Unrounded weighted score; rounded only for display/final output. */
  weighted_score: number;
}

export interface OverallScores {
  behavioral_average: number | null;
  technical_knowledge_average: number | null;
  technical_scenario_average: number | null;
  overall_score: number;
  readiness_band: string;
  question_count: number;
  notes: string;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Overall = mean of all question scores (equal question weight). Rounded once here. */
export function overallScores(questions: QuestionScore[]): OverallScores {
  const by = (c: Category) => mean(questions.filter((q) => q.category === c).map((q) => q.weighted_score));
  const overallRaw = mean(questions.map((q) => q.weighted_score)) ?? 0;
  const overall = roundScore(overallRaw);
  const r = (x: number | null) => (x === null ? null : roundScore(x));
  return {
    behavioral_average: r(by("behavioral")),
    technical_knowledge_average: r(by("technical_knowledge")),
    technical_scenario_average: r(by("technical_scenario")),
    overall_score: overall,
    readiness_band: readinessBand(overall),
    question_count: questions.length,
    notes: "Scores are coaching indicators, not predictions or guarantees of hiring.",
  };
}

/** A zero evaluation for an unanswered/skipped question: no evidence, so no credit. */
export function zeroDimensions(category: Category, reason: string): Record<string, DimensionScore> {
  return Object.fromEntries(
    rubricFor(category).map((d) => [
      d.key,
      { score: 0, evidence: "No response provided.", gap: reason, actionable_tip: `Answer the question and address ${d.label.toLowerCase()}.` },
    ]),
  );
}

export function dimensionDeltas(
  before: Record<string, { score: number }>,
  after: Record<string, { score: number }>,
  rubric: RubricDimension[],
) {
  return rubric.map((d) => ({
    key: d.key,
    label: d.label,
    before: before[d.key]?.score ?? 0,
    after: after[d.key]?.score ?? 0,
    delta: (after[d.key]?.score ?? 0) - (before[d.key]?.score ?? 0),
  }));
}
