/**
 * Optional, passwordless sign-in: the candidate enters an email address, receives a
 * 6-digit code, and enters it. Codes are stored only as salted hashes, expire after
 * 10 minutes and allow 5 attempts; sending is rate-limited per address and per client.
 * A successful sign-in moves the browser's anonymous interviews into the account.
 */
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { getDb } from "./db";
import { EmailError, emailTransport, sendEmail } from "./email";
import { ServiceError } from "./interview";
import { getSetting, setSetting } from "./settings";

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const RESEND_AFTER_MS = 60_000;
const MAX_CODES_PER_HOUR = 5;
const MAX_REQUESTS_PER_CLIENT_PER_HOUR = 20;
export const SESSION_TTL_MS = 90 * 24 * 60 * 60_000;

export interface User {
  id: string;
  email: string;
  candidate_id: string;
}

/** Sign-in is offered only when emails can actually be delivered. */
export function authEnabled(): boolean {
  return emailTransport() !== null;
}

const now = () => new Date();

export function normalizeEmail(input: unknown): string {
  const email = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ServiceError("Enter a valid email address.");
  return email;
}

/** Per-deployment secret used to salt code and session hashes (AUTH_SECRET, else generated once). */
function secret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  let s = getSetting("auth_secret");
  if (!s) {
    s = randomBytes(32).toString("hex");
    setSetting("auth_secret", s);
  }
  return s;
}

const hash = (...parts: string[]) => createHash("sha256").update([secret(), ...parts].join("\u0000")).digest("hex");

const clientRequests = new Map<string, number[]>();
function rateLimitClient(client: string) {
  const cutoff = Date.now() - 60 * 60_000;
  const recent = (clientRequests.get(client) ?? []).filter((t) => t > cutoff);
  if (recent.length >= MAX_REQUESTS_PER_CLIENT_PER_HOUR) throw new ServiceError("Too many sign-in attempts. Please try again later.", 429);
  recent.push(Date.now());
  clientRequests.set(client, recent);
}

function codeEmail(code: string) {
  const text = `Your TreTechPro AI Interview Coach sign-in code is ${code}.\n\nIt expires in 10 minutes. If you didn't request it, you can ignore this email.`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:auto;padding:24px;color:#111">
  <h2 style="margin:0 0 12px">Your sign-in code</h2>
  <p style="margin:0 0 16px">Use this code to sign in to the TreTechPro AI Interview Coach:</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:0 0 16px;color:#0f67c7">${code}</p>
  <p style="margin:0;color:#555;font-size:13px">It expires in 10 minutes. If you didn't request it, you can ignore this email.</p>
</div>`;
  return { subject: `Your TreTechPro sign-in code: ${code}`, text, html };
}

export async function requestLoginCode(emailInput: unknown, client: string): Promise<{ email: string }> {
  if (!authEnabled()) throw new ServiceError("Sign-in isn't available yet.", 404);
  const email = normalizeEmail(emailInput);
  rateLimitClient(client);
  const db = getDb();
  const recent = db
    .prepare(`SELECT created_at, consumed_at FROM login_codes WHERE email = ? AND created_at > ? ORDER BY created_at DESC`)
    .all(email, new Date(Date.now() - 60 * 60_000).toISOString()) as { created_at: string; consumed_at: string | null }[];
  // The one-minute wait applies only while an unused code is pending (not after a successful sign-in).
  if (recent[0] && !recent[0].consumed_at && Date.now() - Date.parse(recent[0].created_at) < RESEND_AFTER_MS) {
    throw new ServiceError("A code was just sent. Please wait a minute before requesting another.", 429);
  }
  if (recent.length >= MAX_CODES_PER_HOUR) throw new ServiceError("Too many codes requested for this email. Please try again later.", 429);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const id = randomUUID();
  db.transaction(() => {
    // Only the newest code is valid.
    db.prepare(`UPDATE login_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL`).run(now().toISOString(), email);
    db.prepare(`INSERT INTO login_codes (id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      id,
      email,
      hash("code", email, code),
      new Date(Date.now() + CODE_TTL_MS).toISOString(),
      now().toISOString(),
    );
  })();
  try {
    await sendEmail({ to: email, ...codeEmail(code) });
  } catch (err) {
    db.prepare(`DELETE FROM login_codes WHERE id = ?`).run(id);
    if (err instanceof EmailError) throw new ServiceError(err.message, 502);
    throw err;
  }
  return { email };
}

interface CodeRow {
  id: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
}

/**
 * Checks a code and signs the candidate in. `anonymousCandidateId` is the browser's
 * anonymous id; its interviews are moved into the account.
 */
export function verifyLoginCode(
  emailInput: unknown,
  codeInput: unknown,
  anonymousCandidateId: string | null,
): { token: string; user: User; movedInterviews: number } {
  if (!authEnabled()) throw new ServiceError("Sign-in isn't available yet.", 404);
  const email = normalizeEmail(emailInput);
  const code = typeof codeInput === "string" ? codeInput.replace(/\s+/g, "") : "";
  if (!/^\d{6}$/.test(code)) throw new ServiceError("Enter the 6-digit code from the email.");
  const db = getDb();
  const row = db
    .prepare(`SELECT id, code_hash, expires_at, attempts FROM login_codes WHERE email = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`)
    .get(email) as CodeRow | undefined;
  if (!row || Date.parse(row.expires_at) < Date.now()) throw new ServiceError("That code has expired. Request a new one.", 400);
  if (row.attempts >= MAX_ATTEMPTS) throw new ServiceError("Too many incorrect attempts. Request a new code.", 429);
  const ok = timingSafeEqual(Buffer.from(hash("code", email, code)), Buffer.from(row.code_hash));
  if (!ok) {
    db.prepare(`UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?`).run(row.id);
    const left = MAX_ATTEMPTS - row.attempts - 1;
    throw new ServiceError(left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many incorrect attempts. Request a new code.", 400);
  }

  let movedInterviews = 0;
  const token = randomBytes(32).toString("base64url");
  const user = db.transaction(() => {
    db.prepare(`UPDATE login_codes SET consumed_at = ? WHERE id = ?`).run(now().toISOString(), row.id);
    let u = db.prepare(`SELECT id, email, candidate_id FROM users WHERE email = ?`).get(email) as User | undefined;
    // An anonymous id can be adopted only if no account already owns it.
    const anonFree = !!anonymousCandidateId && !db.prepare(`SELECT 1 FROM users WHERE candidate_id = ?`).get(anonymousCandidateId);
    if (!u) {
      u = { id: randomUUID(), email, candidate_id: anonFree ? anonymousCandidateId! : randomUUID() };
      db.prepare(`INSERT INTO users (id, email, candidate_id, created_at) VALUES (?, ?, ?, ?)`).run(u.id, u.email, u.candidate_id, now().toISOString());
      if (anonFree) movedInterviews = (db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE candidate_id = ?`).get(u.candidate_id) as { n: number }).n;
    } else if (anonFree && anonymousCandidateId !== u.candidate_id) {
      movedInterviews = db.prepare(`UPDATE sessions SET candidate_id = ? WHERE candidate_id = ?`).run(u.candidate_id, anonymousCandidateId).changes;
      db.prepare(`UPDATE audio_recordings SET candidate_id = ? WHERE candidate_id = ?`).run(u.candidate_id, anonymousCandidateId);
    }
    db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(now().toISOString(), u.id);
    db.prepare(`INSERT INTO user_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(
      hash("session", token),
      u.id,
      now().toISOString(),
      new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    );
    return u;
  })();
  return { token, user, movedInterviews };
}

export function userForSessionToken(token: string | undefined | null): User | null {
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT u.id, u.email, u.candidate_id, s.expires_at FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(hash("session", token)) as (User & { expires_at: string }) | undefined;
  if (!row || Date.parse(row.expires_at) < Date.now()) return null;
  return { id: row.id, email: row.email, candidate_id: row.candidate_id };
}

export function endSession(token: string | undefined | null): void {
  if (token) getDb().prepare(`DELETE FROM user_sessions WHERE token_hash = ?`).run(hash("session", token));
}
