/**
 * Loads and validates tretechpro_star_interview_coach_v3.json, the single source of
 * truth for rubrics, weights, interview modes and agent rules. Everything else in the
 * app reads configuration through this module so the JSON can be swapped for a new
 * version without code changes.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const DATA_DIR = path.join(process.cwd(), "data");
export const CONFIG_PATH = path.join(DATA_DIR, "tretechpro_star_interview_coach_v3.json");
export const CSV_PATH = path.join(DATA_DIR, "tretechpro_star_interview_coach_v3_questions.csv");
export const PROMPT_PATH = path.join(DATA_DIR, "tretechpro_star_interview_coach_v3_agent_prompt.txt");

export const CATEGORIES = ["behavioral", "technical_knowledge", "technical_scenario"] as const;
export type Category = (typeof CATEGORIES)[number];

export const LEVELS = ["entry", "mid", "senior"] as const;
export type ExperienceLevel = (typeof LEVELS)[number];

export const RUBRIC_IDS: Record<Category, string> = {
  behavioral: "star_v3",
  technical_knowledge: "technical_v3",
  technical_scenario: "scenario_v3",
};

const weights = z.record(z.string(), z.number().int().min(0).max(100)).refine(
  (w) => Object.values(w).reduce((a, b) => a + b, 0) === 100,
  { message: "rubric weights must sum to 100" },
);

const levelVariant = z.object({ assessment_focus: z.string().min(1), expected_depth: z.string().min(1) });

const questionSchema = z.object({
  id: z.string().regex(/^\d{2}-[BT]\d{2}$/),
  role: z.string(),
  category: z.enum(CATEGORIES),
  question: z.string().min(10),
  evaluation_framework: z.enum(["STAR", "technical", "scenario"]),
  difficulty: z.string(),
  competency: z.string(),
  experience_level_variants: z.object({ entry: levelVariant, mid: levelVariant, senior: levelVariant }),
  followup_templates: z.array(z.string()).min(1),
  rubric_id: z.enum(["star_v3", "technical_v3", "scenario_v3"]),
});

const configSchema = z.object({
  product: z.string(),
  version: z.string(),
  question_count: z.number().int(),
  roles: z.array(z.string()).min(1),
  questions_per_role: z.object({
    behavioral: z.number().int(),
    technical_knowledge: z.number().int(),
    technical_scenario: z.number().int(),
  }),
  behavioral_weights: weights,
  technical_weights: weights,
  scenario_weights: weights,
  agent_rules: z.array(z.string()),
  questions: z.array(questionSchema),
  features: z.record(z.string(), z.unknown()),
  experience_level_guidance: z.object({
    entry: z.object({ focus: z.string(), depth: z.string() }),
    mid: z.object({ focus: z.string(), depth: z.string() }),
    senior: z.object({ focus: z.string(), depth: z.string() }),
  }),
  interview_configuration: z.object({
    required: z.array(z.string()),
    optional: z.array(z.string()),
    defaults: z.object({
      interview_mode: z.string(),
      response_mode: z.string(),
      question_count: z.number().int(),
      time_limit_minutes: z.number().nullable(),
    }),
    modes: z.record(z.string(), z.record(z.string(), z.number().int())),
    selection_rule: z.string(),
  }),
  adaptive_interview_policy: z.object({
    base_questions: z.string(),
    followups_per_question_max: z.number().int().min(0),
    followup_triggers: z.array(z.string()).min(1),
    followup_style: z.string(),
    experience_adaptation: z.string(),
    time_management: z.string(),
    fairness: z.string(),
  }),
  response_storage_schema: z.record(z.string(), z.string()),
  evaluation_schema: z.object({
    per_dimension: z.record(z.string(), z.string()),
    per_question: z.record(z.string(), z.string()),
    overall: z.record(z.string(), z.string()),
    rubrics: z.object({ behavioral: weights, technical_knowledge: weights, technical_scenario: weights }),
    scoring_anchors: z.record(z.string(), z.string()),
    calculation: z.string(),
  }),
  retry_and_coaching: z.object({
    flow: z.array(z.string()),
    retry_limit: z.number().int().nullable(),
    progress_metrics: z.array(z.string()),
    comparison_rule: z.string(),
  }),
  report_spec: z.object({
    sections: z.array(z.string()),
    formats: z.array(z.string()),
    privacy: z.string(),
  }),
  agent_system_prompt: z.string().min(50),
});

export type InterviewConfig = z.infer<typeof configSchema>;
export type ConfigQuestion = z.infer<typeof questionSchema>;

/** Cross-field checks the schema alone can't express. Returns a list of problems. */
export function checkConfigConsistency(cfg: InterviewConfig): string[] {
  const problems: string[] = [];
  const roleSet = new Set(cfg.roles);
  if (roleSet.size !== cfg.roles.length) problems.push("duplicate roles in roles[]");
  if (cfg.questions.length !== cfg.question_count) {
    problems.push(`question_count=${cfg.question_count} but ${cfg.questions.length} questions present`);
  }
  const ids = new Set<string>();
  for (const q of cfg.questions) {
    if (ids.has(q.id)) problems.push(`duplicate question id ${q.id}`);
    ids.add(q.id);
    if (!roleSet.has(q.role)) problems.push(`${q.id}: unknown role "${q.role}"`);
    if (q.rubric_id !== RUBRIC_IDS[q.category]) {
      problems.push(`${q.id}: category ${q.category} must use ${RUBRIC_IDS[q.category]}, found ${q.rubric_id}`);
    }
  }
  for (const role of cfg.roles) {
    for (const cat of CATEGORIES) {
      const n = cfg.questions.filter((q) => q.role === role && q.category === cat).length;
      if (n !== cfg.questions_per_role[cat]) {
        problems.push(`${role}: expected ${cfg.questions_per_role[cat]} ${cat} questions, found ${n}`);
      }
    }
  }
  const r = cfg.evaluation_schema.rubrics;
  const same = (a: Record<string, number>, b: Record<string, number>) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(r.behavioral, cfg.behavioral_weights)) problems.push("behavioral rubric != behavioral_weights");
  if (!same(r.technical_knowledge, cfg.technical_weights)) problems.push("technical rubric != technical_weights");
  if (!same(r.technical_scenario, cfg.scenario_weights)) problems.push("scenario rubric != scenario_weights");
  return problems;
}

export function parseConfig(raw: unknown): InterviewConfig {
  const cfg = configSchema.parse(raw);
  const problems = checkConfigConsistency(cfg);
  if (problems.length) throw new Error(`Invalid interview config:\n- ${problems.join("\n- ")}`);
  return cfg;
}

let cached: InterviewConfig | null = null;
export function getConfig(): InterviewConfig {
  if (!cached) cached = parseConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")));
  return cached;
}

/** The agent prompt as shipped in the .txt file (must match agent_system_prompt in the JSON). */
export function getAgentPrompt(): string {
  return fs.readFileSync(PROMPT_PATH, "utf8").trim();
}

// ---------------------------------------------------------------------------
// Rubric helpers

export interface RubricDimension {
  key: string;
  label: string;
  weight: number;
}

const DIMENSION_LABELS: Record<string, string> = {
  situation: "Situation",
  task: "Task",
  action: "Action",
  result: "Result",
  accuracy: "Technical accuracy",
  reasoning: "Reasoning",
  completeness: "Completeness",
  communication: "Communication",
  problem_framing: "Problem framing",
  proposed_actions: "Proposed actions",
  validation_and_outcome: "Validation & outcome",
  communication_and_risk: "Communication & risk",
};

export function rubricFor(category: Category, cfg: InterviewConfig = getConfig()): RubricDimension[] {
  return Object.entries(cfg.evaluation_schema.rubrics[category]).map(([key, weight]) => ({
    key,
    label: DIMENSION_LABELS[key] ?? key,
    weight,
  }));
}

export function dimensionLabel(key: string): string {
  return DIMENSION_LABELS[key] ?? key;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  behavioral: "Behavioral (STAR)",
  technical_knowledge: "Technical knowledge",
  technical_scenario: "Technical scenario",
};

export const LEVEL_LABELS: Record<ExperienceLevel, string> = {
  entry: "Entry-Level",
  mid: "Mid-Level",
  senior: "Senior",
};

// ---------------------------------------------------------------------------
// Interview modes. The PDF asks for Full / Behavioral / Technical Knowledge /
// Technical Scenarios; the JSON also defines technical_only (knowledge + scenario).

export const INTERVIEW_MODES = {
  full: { label: "Full Interview (15 questions)", categories: ["behavioral", "technical_knowledge", "technical_scenario"] },
  behavioral_only: { label: "Behavioral STAR (5 questions)", categories: ["behavioral"] },
  technical_knowledge_only: { label: "Technical Knowledge (5 questions)", categories: ["technical_knowledge"] },
  technical_scenario_only: { label: "Technical Scenarios (5 questions)", categories: ["technical_scenario"] },
  technical_only: { label: "Technical Knowledge + Scenarios (10 questions)", categories: ["technical_knowledge", "technical_scenario"] },
} as const satisfies Record<string, { label: string; categories: readonly Category[] }>;
export type InterviewMode = keyof typeof INTERVIEW_MODES;

export function isInterviewMode(v: unknown): v is InterviewMode {
  return typeof v === "string" && Object.hasOwn(INTERVIEW_MODES, v);
}

export function readinessBand(score: number): string {
  // "0-49 foundation building; 50-69 developing; 70-84 proficient; 85-100 strong practice performance"
  if (score >= 85) return "Strong practice performance";
  if (score >= 70) return "Proficient";
  if (score >= 50) return "Developing";
  return "Foundation building";
}
