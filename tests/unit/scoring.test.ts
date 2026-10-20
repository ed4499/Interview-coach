import { describe, expect, it } from "vitest";
import { readinessBand, rubricFor } from "@/lib/config";
import { overallScores, weightedScore } from "@/lib/scoring";

describe("scoring", () => {
  it("applies STAR weights 20/20/40/20", () => {
    const s = weightedScore({ situation: { score: 80 }, task: { score: 60 }, action: { score: 50 }, result: { score: 40 } }, rubricFor("behavioral"));
    expect(s).toBeCloseTo(16 + 12 + 20 + 8);
  });

  it("applies technical and scenario weights", () => {
    expect(weightedScore({ accuracy: { score: 100 }, reasoning: { score: 0 }, completeness: { score: 0 }, communication: { score: 0 } }, rubricFor("technical_knowledge"))).toBe(40);
    expect(weightedScore({ problem_framing: { score: 0 }, proposed_actions: { score: 100 }, validation_and_outcome: { score: 0 }, communication_and_risk: { score: 0 } }, rubricFor("technical_scenario"))).toBe(35);
  });

  it("scores missing dimensions as 0 and clamps out-of-range values", () => {
    expect(weightedScore({ action: { score: 100 } }, rubricFor("behavioral"))).toBe(40);
    expect(weightedScore({ situation: { score: 250 }, task: { score: -5 }, action: { score: 0 }, result: { score: 0 } }, rubricFor("behavioral"))).toBe(20);
  });

  it("rounds once, at the final score", () => {
    const qs = [70.4, 70.4, 70.4, 71.4].map((w, i) => ({ question_id: String(i), category: "behavioral" as const, weighted_score: w }));
    // Raw mean 70.65 -> 71. Rounding each question first would give (70+70+70+71)/4 = 70.25 -> 70.
    expect(overallScores(qs).overall_score).toBe(71);
    expect(overallScores(qs).notes).toMatch(/not predictions or guarantees/);
  });

  it("weights every question equally in the overall score", () => {
    const o = overallScores([
      { question_id: "a", category: "behavioral", weighted_score: 100 },
      { question_id: "b", category: "technical_knowledge", weighted_score: 0 },
      { question_id: "c", category: "technical_knowledge", weighted_score: 0 },
    ]);
    expect(o.overall_score).toBe(33); // not the mean of category averages (50)
  });

  it("assigns readiness bands at the configured boundaries", () => {
    expect([0, 49, 50, 69, 70, 84, 85, 100].map(readinessBand)).toEqual([
      "Foundation building", "Foundation building", "Developing", "Developing", "Proficient", "Proficient",
      "Strong practice performance", "Strong practice performance",
    ]);
  });
});
