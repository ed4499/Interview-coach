/**
 * Imports the CSV question bank, verifies it against the JSON configuration, and
 * selects the exact role-specific questions for an interview. Questions are never
 * swapped across roles or generated on the fly.
 */
import fs from "node:fs";
import Papa from "papaparse";
import {
  CATEGORIES,
  CSV_PATH,
  INTERVIEW_MODES,
  type Category,
  type ConfigQuestion,
  type InterviewConfig,
  type InterviewMode,
  getConfig,
} from "./config";

export interface BankQuestion {
  id: string;
  role: string;
  category: Category;
  question: string;
  competency: string;
  difficulty: string;
  rubric_id: string;
  followup_templates: string[];
}

interface CsvRow {
  id: string;
  role: string;
  category: string;
  question: string;
  competency: string;
  difficulty: string;
  rubric_id: string;
}

export function parseQuestionCsv(text: string): CsvRow[] {
  const parsed = Papa.parse<CsvRow>(text, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) {
    throw new Error(`CSV parse errors: ${parsed.errors.map((e) => `row ${e.row}: ${e.message}`).join("; ")}`);
  }
  return parsed.data;
}

/**
 * Merges CSV rows with the JSON questions (which carry follow-up templates) and
 * returns the problems found. The CSV is the imported bank; the JSON must agree.
 */
export function buildBank(rows: CsvRow[], cfg: InterviewConfig): { bank: BankQuestion[]; problems: string[] } {
  const problems: string[] = [];
  const byId = new Map<string, ConfigQuestion>(cfg.questions.map((q) => [q.id, q]));
  const seen = new Set<string>();
  const bank: BankQuestion[] = [];

  for (const r of rows) {
    if (seen.has(r.id)) problems.push(`CSV duplicate id ${r.id}`);
    seen.add(r.id);
    const j = byId.get(r.id);
    if (!j) {
      problems.push(`CSV id ${r.id} missing from JSON`);
      continue;
    }
    for (const f of ["role", "category", "question", "competency", "difficulty", "rubric_id"] as const) {
      if (r[f] !== j[f]) problems.push(`${r.id}: CSV ${f} differs from JSON`);
    }
    if (!(CATEGORIES as readonly string[]).includes(r.category)) problems.push(`${r.id}: bad category ${r.category}`);
    bank.push({
      id: r.id,
      role: r.role,
      category: r.category as Category,
      question: r.question,
      competency: r.competency,
      difficulty: r.difficulty,
      rubric_id: r.rubric_id,
      followup_templates: j.followup_templates,
    });
  }
  for (const id of byId.keys()) if (!seen.has(id)) problems.push(`JSON id ${id} missing from CSV`);

  for (const role of cfg.roles) {
    for (const cat of CATEGORIES) {
      const n = bank.filter((q) => q.role === role && q.category === cat).length;
      if (n !== cfg.questions_per_role[cat]) problems.push(`${role}: ${n} ${cat} questions in CSV (expected ${cfg.questions_per_role[cat]})`);
    }
  }
  return { bank, problems };
}

let cachedBank: BankQuestion[] | null = null;
export function getBank(): BankQuestion[] {
  if (!cachedBank) {
    const { bank, problems } = buildBank(parseQuestionCsv(fs.readFileSync(CSV_PATH, "utf8")), getConfig());
    if (problems.length) throw new Error(`Question bank invalid:\n- ${problems.join("\n- ")}`);
    cachedBank = bank;
  }
  return cachedBank;
}

/**
 * Returns the primary questions for a role and mode in a fixed order:
 * behavioral, then technical knowledge, then technical scenario, each by id.
 */
export function selectQuestions(role: string, mode: InterviewMode, bank: BankQuestion[] = getBank()): BankQuestion[] {
  const cfg = getConfig();
  if (!cfg.roles.includes(role)) throw new Error(`Unknown role: ${role}`);
  const cats = INTERVIEW_MODES[mode].categories as readonly Category[];
  const out: BankQuestion[] = [];
  for (const cat of cats) {
    const qs = bank.filter((q) => q.role === role && q.category === cat).sort((a, b) => a.id.localeCompare(b.id));
    if (qs.length !== cfg.questions_per_role[cat]) {
      throw new Error(`${role} has ${qs.length} ${cat} questions; expected ${cfg.questions_per_role[cat]}`);
    }
    out.push(...qs);
  }
  return out;
}
