import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, setDb } from "@/lib/db";
import { setAI } from "@/lib/ai";
import type { EvaluationResult, InterviewAI, QuestionContext } from "@/lib/ai";
import { rubricFor } from "@/lib/config";

/** Deterministic fake: each dimension gets a fixed score per category; counts calls. */
export class ScriptedAI implements InterviewAI {
  readonly name = "scripted-test";
  calls = { followup: 0, evaluate: 0, summarize: 0, compare: 0 };
  failEvaluateFor = new Set<string>();
  followupFor = new Set<string>();
  scores: Record<string, number> = {
    situation: 80, task: 60, action: 50, result: 40,
    accuracy: 70, reasoning: 60, completeness: 50, communication: 90,
    problem_framing: 60, proposed_actions: 80, validation_and_outcome: 40, communication_and_risk: 70,
  };
  /** Added to every dimension when the response contains "IMPROVED". */
  retryBonus = 20;

  async decideFollowup(q: QuestionContext) {
    this.calls.followup++;
    return this.followupFor.has(q.id)
      ? { needs_followup: true, trigger: "vague outcome", followup_question: q.followup_templates[0] }
      : { needs_followup: false, trigger: null, followup_question: null };
  }
  async evaluate(q: QuestionContext, _c: unknown, a: { responseText: string }): Promise<EvaluationResult> {
    this.calls.evaluate++;
    if (this.failEvaluateFor.has(q.id)) throw new Error(`simulated failure for ${q.id}`);
    const bonus = a.responseText.includes("IMPROVED") ? this.retryBonus : 0;
    return {
      dimensions: Object.fromEntries(
        rubricFor(q.category).map((d) => [d.key, { score: Math.min(100, this.scores[d.key] + bonus), evidence: a.responseText.slice(0, 40), gap: null, actionable_tip: "tip" }]),
      ),
      strengths: ["Clear context"],
      improvements: ["Quantify the result"],
      missing_components: q.category === "behavioral" ? ["Result: no outcome stated"] : ["Validation step"],
      answer_outline: "- **Situation:** [where]\n- **Result:** [measurable result]",
      confidence: "medium",
    };
  }
  async summarize() {
    this.calls.summarize++;
    return {
      coaching_actions: [1, 2, 3].map((p) => ({ priority: p, title: `Action ${p}`, detail: `Detail ${p}`, related_question_ids: [] })),
      overall_notes: "Keep practicing.",
    };
  }
  async compare() {
    this.calls.compare++;
    return { summary: "Added a measurable result.", specific_changes: ["Added result"], remaining_gaps: [] };
  }
}

export function freshEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ttp-test-"));
  process.env.AUDIO_STORAGE_DIR = path.join(dir, "audio");
  const db = openDatabase(":memory:");
  setDb(db);
  const ai = new ScriptedAI();
  setAI(ai);
  return { db, ai, dir };
}
