import { AnthropicInterviewAI } from "./anthropic";
import { TestModeInterviewAI } from "./testMode";
import type { InterviewAI } from "./types";

export * from "./types";

let override: InterviewAI | null = null;
let instance: InterviewAI | null = null;

export function isTestMode(): boolean {
  return process.env.INTERVIEW_AI_MODE === "test";
}

export function getAI(): InterviewAI {
  if (override) return override;
  if (!instance) instance = isTestMode() ? new TestModeInterviewAI() : new AnthropicInterviewAI();
  return instance;
}

/** Test hook: inject a fake implementation. */
export function setAI(ai: InterviewAI | null) {
  override = ai;
}
