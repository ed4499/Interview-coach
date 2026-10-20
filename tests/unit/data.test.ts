import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { CATEGORIES, CSV_PATH, INTERVIEW_MODES, type InterviewMode, getAgentPrompt, getConfig, rubricFor } from "@/lib/config";
import { buildBank, getBank, parseQuestionCsv, selectQuestions } from "@/lib/questionBank";

describe("configuration and question bank", () => {
  const cfg = getConfig();
  const bank = getBank();

  it("loads all 17 career roles", () => {
    expect(cfg.roles).toHaveLength(17);
    expect(new Set(bank.map((q) => q.role))).toEqual(new Set(cfg.roles));
  });

  it("has exactly 255 questions: 15 primary per role, 5 of each category", () => {
    expect(bank).toHaveLength(255);
    for (const role of cfg.roles) {
      const qs = bank.filter((q) => q.role === role);
      expect(qs, role).toHaveLength(15);
      for (const c of CATEGORIES) expect(qs.filter((q) => q.category === c), `${role} ${c}`).toHaveLength(5);
    }
  });

  it("maps every category to its rubric", () => {
    for (const q of bank) {
      expect(q.rubric_id).toBe({ behavioral: "star_v3", technical_knowledge: "technical_v3", technical_scenario: "scenario_v3" }[q.category]);
      expect(q.followup_templates.length).toBeGreaterThan(0);
    }
  });

  it("uses the configured weights, each summing to 100", () => {
    expect(rubricFor("behavioral").map((d) => [d.key, d.weight])).toEqual([["situation", 20], ["task", 20], ["action", 40], ["result", 20]]);
    expect(rubricFor("technical_knowledge").map((d) => [d.key, d.weight])).toEqual([["accuracy", 40], ["reasoning", 25], ["completeness", 20], ["communication", 15]]);
    expect(rubricFor("technical_scenario").map((d) => [d.key, d.weight])).toEqual([
      ["problem_framing", 20], ["proposed_actions", 35], ["validation_and_outcome", 25], ["communication_and_risk", 20],
    ]);
  });

  it("agent prompt file matches the JSON", () => {
    expect(getAgentPrompt()).toBe(cfg.agent_system_prompt.trim());
  });

  it("detects a corrupted CSV bank", () => {
    const rows = parseQuestionCsv(fs.readFileSync(CSV_PATH, "utf8"));
    const missing = buildBank(rows.slice(1), cfg);
    expect(missing.problems.some((p) => p.includes("01-B01"))).toBe(true);
    const altered = rows.map((r, i) => (i === 3 ? { ...r, role: "Help Desk" } : r));
    expect(buildBank(altered, cfg).problems.length).toBeGreaterThan(0);
  });

  it("selects only the chosen role's questions with the right counts per mode", () => {
    const expected: Record<InterviewMode, number> = { full: 15, behavioral_only: 5, technical_knowledge_only: 5, technical_scenario_only: 5, technical_only: 10 };
    for (const role of cfg.roles) {
      for (const mode of Object.keys(INTERVIEW_MODES) as InterviewMode[]) {
        const qs = selectQuestions(role, mode);
        expect(qs).toHaveLength(expected[mode]);
        expect(qs.every((q) => q.role === role)).toBe(true);
        expect(new Set(qs.map((q) => q.category))).toEqual(new Set(INTERVIEW_MODES[mode].categories));
      }
    }
    expect(() => selectQuestions("Astronaut", "full")).toThrow();
  });
});
