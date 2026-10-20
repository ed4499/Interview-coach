/**
 * JSON Schemas sent to Claude as structured-output formats, plus Zod validators that
 * re-check every response before it is stored. Dimension keys come from the rubric in
 * the config, so a behavioral answer can only ever receive S/T/A/R scores, etc.
 */
import { z } from "zod";
import { type Category, getConfig, rubricFor } from "../config";
import { clampScore } from "../scoring";

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };

export function evaluationJsonSchema(category: Category) {
  const dims = rubricFor(category);
  const dimension = {
    type: "object",
    properties: {
      score: { type: "integer", description: "0-100 using the scoring anchors" },
      evidence: { type: "string", description: "Short quote or faithful paraphrase of the candidate's words" },
      gap: { ...nullableString, description: "Specific missing element, or null" },
      actionable_tip: { type: "string" },
    },
    required: ["score", "evidence", "gap", "actionable_tip"],
    additionalProperties: false,
  };
  return {
    type: "object",
    properties: {
      dimensions: {
        type: "object",
        properties: Object.fromEntries(dims.map((d) => [d.key, dimension])),
        required: dims.map((d) => d.key),
        additionalProperties: false,
      },
      strengths: { type: "array", items: { type: "string" } },
      improvements: { type: "array", items: { type: "string" } },
      missing_components: { type: "array", items: { type: "string" } },
      answer_outline: { type: "string" },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
    },
    required: ["dimensions", "strengths", "improvements", "missing_components", "answer_outline", "confidence"],
    additionalProperties: false,
  };
}

export function evaluationValidator(category: Category) {
  const dims = rubricFor(category);
  const dimension = z.object({
    score: z.number().transform(clampScore),
    evidence: z.string(),
    gap: z.string().nullable(),
    actionable_tip: z.string(),
  });
  return z.object({
    dimensions: z.object(Object.fromEntries(dims.map((d) => [d.key, dimension]))).strict(),
    strengths: z.array(z.string()),
    improvements: z.array(z.string()),
    missing_components: z.array(z.string()),
    answer_outline: z.string().min(1),
    confidence: z.enum(["low", "medium", "high"]),
  });
}

export function followupJsonSchema() {
  return {
    type: "object",
    properties: {
      needs_followup: { type: "boolean" },
      trigger: { anyOf: [{ type: "string", enum: getConfig().adaptive_interview_policy.followup_triggers }, { type: "null" }] },
      followup_question: nullableString,
    },
    required: ["needs_followup", "trigger", "followup_question"],
    additionalProperties: false,
  };
}

export const followupValidator = z
  .object({ needs_followup: z.boolean(), trigger: z.string().nullable(), followup_question: z.string().nullable() })
  .transform((d) =>
    d.needs_followup && d.followup_question?.trim()
      ? { needs_followup: true, trigger: d.trigger, followup_question: d.followup_question.trim() }
      : { needs_followup: false, trigger: null, followup_question: null },
  );

export const coachingJsonSchema = {
  type: "object",
  properties: {
    coaching_actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          priority: { type: "integer" },
          title: { type: "string" },
          detail: { type: "string" },
          related_question_ids: { type: "array", items: { type: "string" } },
        },
        required: ["priority", "title", "detail", "related_question_ids"],
        additionalProperties: false,
      },
    },
    overall_notes: { type: "string" },
  },
  required: ["coaching_actions", "overall_notes"],
  additionalProperties: false,
};

export const coachingValidator = z.object({
  coaching_actions: z
    .array(z.object({ priority: z.number().int(), title: z.string(), detail: z.string(), related_question_ids: z.array(z.string()) }))
    .min(3)
    .transform((a) => [...a].sort((x, y) => x.priority - y.priority).slice(0, 3).map((x, i) => ({ ...x, priority: i + 1 }))),
  overall_notes: z.string(),
});

export const comparisonJsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    specific_changes: { type: "array", items: { type: "string" } },
    remaining_gaps: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "specific_changes", "remaining_gaps"],
  additionalProperties: false,
};

export const comparisonValidator = z.object({
  summary: z.string(),
  specific_changes: z.array(z.string()),
  remaining_gaps: z.array(z.string()),
});
