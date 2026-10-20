import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicInterviewAI } from "@/lib/ai/anthropic";
import { AIUnavailableError, type QuestionContext } from "@/lib/ai";
import { getAgentPrompt } from "@/lib/config";

function fakeClient(payload: unknown, stop_reason = "end_turn") {
  const create = vi.fn().mockResolvedValue({
    stop_reason,
    stop_details: stop_reason === "refusal" ? { category: "cyber" } : null,
    content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload) }],
  });
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

const q = (category: QuestionContext["category"]): QuestionContext => ({
  id: "01-X01",
  category,
  question: "Tell me about a time...",
  competency: "problem solving",
  followup_templates: ["What specifically was your responsibility?"],
});
const cand = { role: "IT Support", level: "mid" as const };
const dim = (score: number) => ({ score, evidence: "I reimaged the laptop", gap: null, actionable_tip: "Quantify it" });
const evalPayload = (keys: string[], score = 75) => ({
  dimensions: Object.fromEntries(keys.map((k) => [k, dim(score)])),
  strengths: ["s"],
  improvements: ["i"],
  missing_components: [],
  answer_outline: "- **Situation:** ...",
  confidence: "high",
});

const STAR = ["situation", "task", "action", "result"];
const TECH = ["accuracy", "reasoning", "completeness", "communication"];
const SCEN = ["problem_framing", "proposed_actions", "validation_and_outcome", "communication_and_risk"];

describe("Claude evaluator", () => {
  it.each([
    ["behavioral", STAR],
    ["technical_knowledge", TECH],
    ["technical_scenario", SCEN],
  ] as const)("requests a %s schema with exactly its rubric dimensions", async (cat, keys) => {
    const { client, create } = fakeClient(evalPayload(keys));
    const ai = new AnthropicInterviewAI("claude-opus-5-5", client);
    const r = await ai.evaluate(q(cat), cand, { responseText: "MY VERBATIM ANSWER", responseSource: "text" });
    expect(Object.keys(r.dimensions)).toEqual(keys);
    const req = create.mock.calls[0][0];
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.fallbacks).toBe("default");
    expect(req.betas).toContain("server-side-fallback-2026-07-01");
    expect(req.output_config.format.type).toBe("json_schema");
    expect(req.output_config.format.schema.properties.dimensions.required).toEqual(keys);
    expect(req.output_config.format.schema.properties.dimensions.additionalProperties).toBe(false);
    expect(req.system.startsWith(getAgentPrompt())).toBe(true);
    expect(req.messages[0].content).toContain("<candidate_response>\nMY VERBATIM ANSWER\n</candidate_response>");
    if (cat === "behavioral") expect(req.system).toMatch(/STAR framework/);
    else expect(req.system).toMatch(/Do NOT force STAR|Do NOT demand fabricated/);
  });

  it("produces the same structured result for the same model output (consistency)", async () => {
    const { client } = fakeClient(evalPayload(STAR, 64));
    const ai = new AnthropicInterviewAI("claude-opus-5-5", client);
    const a = await ai.evaluate(q("behavioral"), cand, { responseText: "x", responseSource: "text" });
    const b = await ai.evaluate(q("behavioral"), cand, { responseText: "x", responseSource: "text" });
    expect(a).toEqual(b);
  });

  it("rejects output with a missing or foreign dimension", async () => {
    const bad = evalPayload(["situation", "task", "action"]);
    await expect(new AnthropicInterviewAI("m", fakeClient(bad).client).evaluate(q("behavioral"), cand, { responseText: "x", responseSource: "text" })).rejects.toThrow(AIUnavailableError);
    const foreign = evalPayload([...STAR, "accuracy"]);
    await expect(new AnthropicInterviewAI("m", fakeClient(foreign).client).evaluate(q("behavioral"), cand, { responseText: "x", responseSource: "text" })).rejects.toThrow(AIUnavailableError);
  });

  it("clamps out-of-range scores", async () => {
    const p = evalPayload(TECH);
    p.dimensions.accuracy.score = 140;
    const r = await new AnthropicInterviewAI("m", fakeClient(p).client).evaluate(q("technical_knowledge"), cand, { responseText: "x", responseSource: "text" });
    expect(r.dimensions.accuracy.score).toBe(100);
  });

  it("surfaces refusals, truncation and malformed JSON as errors", async () => {
    const args = [q("behavioral"), cand, { responseText: "x", responseSource: "text" as const }] as const;
    await expect(new AnthropicInterviewAI("m", fakeClient({}, "refusal").client).evaluate(...args)).rejects.toThrow(/declined/);
    await expect(new AnthropicInterviewAI("m", fakeClient(evalPayload(STAR), "max_tokens").client).evaluate(...args)).rejects.toThrow(/truncated/);
    await expect(new AnthropicInterviewAI("m", fakeClient("not json").client).evaluate(...args)).rejects.toThrow(/malformed/);
  });

  it("tells the evaluator not to penalize transcription errors for voice answers", async () => {
    const { client, create } = fakeClient(evalPayload(STAR));
    await new AnthropicInterviewAI("m", client).evaluate(q("behavioral"), cand, { responseText: "um so", responseSource: "audio_transcript" });
    expect(create.mock.calls[0][0].messages[0].content).toMatch(/transcription errors/);
    expect(create.mock.calls[0][0].system).toMatch(/accent/);
  });

  it("normalizes follow-up decisions and keeps exactly three coaching actions", async () => {
    const f = await new AnthropicInterviewAI("m", fakeClient({ needs_followup: true, trigger: "vague outcome", followup_question: "  " }).client).decideFollowup(q("behavioral"), cand, {
      responseText: "x",
      responseSource: "text",
    });
    expect(f.needs_followup).toBe(false);
    const actions = [4, 2, 1, 3].map((p) => ({ priority: p, title: `t${p}`, detail: "d", related_question_ids: [] }));
    const c = await new AnthropicInterviewAI("m", fakeClient({ coaching_actions: actions, overall_notes: "n" }).client).summarize(cand, []);
    expect(c.coaching_actions.map((a) => a.title)).toEqual(["t1", "t2", "t3"]);
  });
});
