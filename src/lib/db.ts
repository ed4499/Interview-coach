/**
 * SQLite persistence (better-sqlite3). Swap this module for the host application's
 * database when integrating into TreTechPro.ai; repo.ts is the only consumer.
 *
 * Integrity rules enforced in the schema itself:
 *  - a submitted response is immutable (trigger), so retries can never overwrite it;
 *  - every attempt is unique per (session, question, attempt_number);
 *  - an attempt has at most one evaluation.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./config";
import { getBank } from "./questionBank";

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('behavioral','technical_knowledge','technical_scenario')),
  question TEXT NOT NULL,
  competency TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  rubric_id TEXT NOT NULL,
  followup_templates TEXT NOT NULL,
  bank_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_role ON questions(role, category);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  role TEXT NOT NULL,
  experience_level TEXT NOT NULL CHECK (experience_level IN ('entry','mid','senior')),
  interview_mode TEXT NOT NULL,
  response_mode TEXT NOT NULL CHECK (response_mode IN ('text','voice')),
  time_limit_minutes INTEGER,
  target_job_description TEXT,
  consent_to_audio_recording INTEGER NOT NULL DEFAULT 0,
  rubric_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress','evaluating','completed','evaluation_failed')),
  started_at TEXT NOT NULL,
  deadline_at TEXT,
  completed_at TEXT,
  overall_json TEXT,
  coaching_json TEXT,
  evaluation_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_candidate ON sessions(candidate_id, started_at);

CREATE TABLE IF NOT EXISTS session_questions (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  question_id TEXT NOT NULL REFERENCES questions(id),
  question_text TEXT NOT NULL,
  category TEXT NOT NULL,
  PRIMARY KEY (session_id, position),
  UNIQUE (session_id, question_id)
);

CREATE TABLE IF NOT EXISTS audio_recordings (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('interview','retry')),
  question_text TEXT NOT NULL,
  response_text TEXT NOT NULL,
  response_source TEXT NOT NULL CHECK (response_source IN ('text','audio_transcript','none')),
  transcript_raw TEXT,
  audio_id TEXT REFERENCES audio_recordings(id) ON DELETE SET NULL,
  followup_text TEXT,
  followup_trigger TEXT,
  followup_response_text TEXT,
  status TEXT NOT NULL CHECK (status IN ('awaiting_followup','submitted','skipped','not_reached')),
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  UNIQUE (session_id, question_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS idx_attempts_session ON attempts(session_id, question_id);

-- Responses are preserved verbatim: once written they can never change.
CREATE TRIGGER IF NOT EXISTS attempts_response_immutable
BEFORE UPDATE OF response_text, question_text, question_id, attempt_number, session_id ON attempts
BEGIN
  SELECT RAISE(ABORT, 'attempt responses are immutable');
END;
CREATE TRIGGER IF NOT EXISTS attempts_followup_response_immutable
BEFORE UPDATE OF followup_response_text ON attempts
WHEN OLD.followup_response_text IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'follow-up responses are immutable');
END;

CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id) ON DELETE CASCADE,
  rubric_id TEXT NOT NULL,
  category TEXT NOT NULL,
  dimension_scores TEXT NOT NULL,
  weighted_score REAL NOT NULL,
  strengths TEXT NOT NULL,
  improvements TEXT NOT NULL,
  missing_components TEXT NOT NULL,
  answer_outline TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('low','medium','high')),
  evaluator TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempt_comparisons (
  retry_attempt_id TEXT PRIMARY KEY REFERENCES attempts(id) ON DELETE CASCADE,
  previous_attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  specific_changes TEXT NOT NULL,
  remaining_gaps TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

let db: Database.Database | null = null;

export function dbPath(): string {
  return process.env.DATABASE_PATH ?? path.join(process.cwd(), "var", "interview-coach.sqlite");
}

export function openDatabase(file: string = dbPath()): Database.Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new Database(file);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.exec(SCHEMA);
  importQuestionBank(conn);
  return conn;
}

export function getDb(): Database.Database {
  if (!db) db = openDatabase();
  return db;
}

/** Test hook: replace the process-wide connection. */
export function setDb(conn: Database.Database | null) {
  db = conn;
}

/** Idempotently upserts the validated CSV bank into the questions table. */
export function importQuestionBank(conn: Database.Database): number {
  const version = getConfig().version;
  const upsert = conn.prepare(`
    INSERT INTO questions (id, role, category, question, competency, difficulty, rubric_id, followup_templates, bank_version)
    VALUES (@id, @role, @category, @question, @competency, @difficulty, @rubric_id, @followup_templates, @bank_version)
    ON CONFLICT(id) DO UPDATE SET role=excluded.role, category=excluded.category, question=excluded.question,
      competency=excluded.competency, difficulty=excluded.difficulty, rubric_id=excluded.rubric_id,
      followup_templates=excluded.followup_templates, bank_version=excluded.bank_version
  `);
  const bank = getBank();
  conn.transaction(() => {
    for (const q of bank) upsert.run({ ...q, followup_templates: JSON.stringify(q.followup_templates), bank_version: version });
  })();
  return bank.length;
}

export function audioDir(): string {
  return process.env.AUDIO_STORAGE_DIR ?? path.join(process.cwd(), "var", "audio");
}
