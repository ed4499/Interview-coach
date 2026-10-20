import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { coachingPrompt, comparisonPrompt, evaluationPrompt, followupPrompt } from "./prompts";
import {
  coachingJsonSchema,
  coachingValidator,
  comparisonJsonSchema,
  comparisonValidator,
  evaluationJsonSchema,
  evaluationValidator,
  followupJsonSchema,
  followupValidator,
} from "./schemas";
import { AIUnavailableError, type InterviewAI } from "./types";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export class AnthropicInterviewAI implements InterviewAI {
  readonly name: string;
  private client: Anthropic;

  constructor(
    private model: string = process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic();
    this.name = `anthropic:${model}`;
  }

  private async structured<S extends z.ZodTypeAny>(
    prompt: { system: string; user: string },
    schema: Record<string, unknown>,
    validator: S,
    effort: Effort,
  ): Promise<z.output<S>> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      // Re-run on Anthropic's recommended fallback model if a safety classifier declines
      // (security-role questions such as pen testing can trip the cyber classifier).
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
      output_config: { effort, format: { type: "json_schema", schema } },
    });
    if (response.stop_reason === "refusal") {
      throw new AIUnavailableError(`The model declined this request (${response.stop_details?.category ?? "unspecified"}).`);
    }
    if (response.stop_reason === "max_tokens") {
      throw new AIUnavailableError("The model response was truncated (max_tokens).");
    }
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AIUnavailableError("The model returned malformed JSON.");
    }
    const parsed = validator.safeParse(json);
    if (!parsed.success) throw new AIUnavailableError(`The model output failed validation: ${parsed.error.message}`);
    return parsed.data;
  }

  decideFollowup: InterviewAI["decideFollowup"] = (q, c, a) =>
    this.structured(followupPrompt(q, c, a), followupJsonSchema(), followupValidator, "low");

  evaluate: InterviewAI["evaluate"] = (q, c, a) =>
    this.structured(evaluationPrompt(q, c, a), evaluationJsonSchema(q.category), evaluationValidator(q.category), "high");

  summarize: InterviewAI["summarize"] = (c, qs) =>
    this.structured(coachingPrompt(c, qs), coachingJsonSchema, coachingValidator, "medium");

  compare: InterviewAI["compare"] = (q, c, prev, rev) =>
    this.structured(comparisonPrompt(q, c, prev, rev), comparisonJsonSchema, comparisonValidator, "medium");
}
