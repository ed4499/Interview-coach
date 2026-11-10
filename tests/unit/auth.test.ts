import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authEnabled, endSession, normalizeEmail, requestLoginCode, userForSessionToken, verifyLoginCode } from "@/lib/auth";
import { createSession } from "@/lib/interview";
import { freshEnv } from "./helpers";
import type Database from "better-sqlite3";

const ENV = { ...process.env };
let db: Database.Database;
let client = 0;

beforeEach(() => {
  ({ db } = freshEnv());
  process.env.INTERVIEW_AI_MODE = "test"; // emails go to the dev outbox
  client += 1;
});
afterEach(() => {
  process.env = { ...ENV };
});

function lastCode(email: string): string {
  const row = db.prepare(`SELECT text FROM dev_outbox WHERE to_email = ? ORDER BY id DESC LIMIT 1`).get(email) as { text: string };
  return row.text.match(/\b(\d{6})\b/)![1];
}

describe("email-code sign-in", () => {
  it("validates email addresses", () => {
    expect(normalizeEmail("  Ann@Example.COM ")).toBe("ann@example.com");
    expect(() => normalizeEmail("not-an-email")).toThrow(/valid email/);
  });

  it("emails a 6-digit code and stores only its hash", async () => {
    await requestLoginCode("ann@example.com", `c${client}`);
    const code = lastCode("ann@example.com");
    const stored = db.prepare(`SELECT code_hash FROM login_codes WHERE email = ?`).get("ann@example.com") as { code_hash: string };
    expect(stored.code_hash).not.toContain(code);
    expect(stored.code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("signs in with the right code, creating an account that adopts this browser's interviews", async () => {
    const s = createSession("anon-1", { role: "IT Support", experience_level: "mid" });
    await requestLoginCode("ann@example.com", `c${client}`);
    const r = verifyLoginCode("ann@example.com", lastCode("ann@example.com"), "anon-1");
    expect(r.user.email).toBe("ann@example.com");
    expect(r.user.candidate_id).toBe("anon-1");
    expect(r.movedInterviews).toBe(1);
    expect(userForSessionToken(r.token)).toEqual(r.user);
    expect((db.prepare(`SELECT candidate_id FROM sessions WHERE id = ?`).get(s.id) as { candidate_id: string }).candidate_id).toBe("anon-1");
    // A code works only once.
    expect(() => verifyLoginCode("ann@example.com", lastCode("ann@example.com"), null)).toThrow(/expired/);
  });

  it("moves interviews from another browser into an existing account", async () => {
    await requestLoginCode("ann@example.com", `c${client}`);
    const first = verifyLoginCode("ann@example.com", lastCode("ann@example.com"), "browser-a");
    createSession("browser-b", { role: "Help Desk", experience_level: "entry" });
    db.prepare(`UPDATE login_codes SET created_at = ?`).run(new Date(Date.now() - 120_000).toISOString());
    await requestLoginCode("ann@example.com", `c${client}`);
    const second = verifyLoginCode("ann@example.com", lastCode("ann@example.com"), "browser-b");
    expect(second.user.candidate_id).toBe(first.user.candidate_id);
    expect(second.movedInterviews).toBe(1);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE candidate_id = ?`).get(first.user.candidate_id)).toEqual({ n: 1 });
  });

  it("never adopts an id that already belongs to another account", async () => {
    await requestLoginCode("ann@example.com", `c${client}`);
    const ann = verifyLoginCode("ann@example.com", lastCode("ann@example.com"), "shared-device");
    await requestLoginCode("bob@example.com", `c${client}`);
    const bob = verifyLoginCode("bob@example.com", lastCode("bob@example.com"), "shared-device");
    expect(bob.user.candidate_id).not.toBe(ann.user.candidate_id);
    expect(bob.movedInterviews).toBe(0);
  });

  it("locks a code after 5 wrong attempts", async () => {
    await requestLoginCode("ann@example.com", `c${client}`);
    const right = lastCode("ann@example.com");
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 4; i >= 1; i--) expect(() => verifyLoginCode("ann@example.com", wrong, null)).toThrow(new RegExp(`${i} tr`));
    expect(() => verifyLoginCode("ann@example.com", wrong, null)).toThrow(/Too many/);
    expect(() => verifyLoginCode("ann@example.com", right, null)).toThrow(/Too many/);
  });

  it("rejects expired codes and rate-limits resends", async () => {
    await requestLoginCode("ann@example.com", `c${client}`);
    await expect(requestLoginCode("ann@example.com", `c${client}`)).rejects.toThrow(/wait a minute/);
    db.prepare(`UPDATE login_codes SET expires_at = ?`).run(new Date(Date.now() - 1000).toISOString());
    expect(() => verifyLoginCode("ann@example.com", lastCode("ann@example.com"), null)).toThrow(/expired/);
  });

  it("only the newest code is valid", async () => {
    await requestLoginCode("ann@example.com", `c${client}`);
    const old = lastCode("ann@example.com");
    db.prepare(`UPDATE login_codes SET created_at = ?`).run(new Date(Date.now() - 120_000).toISOString());
    await requestLoginCode("ann@example.com", `c${client}`);
    const fresh = lastCode("ann@example.com");
    if (old !== fresh) expect(() => verifyLoginCode("ann@example.com", old, null)).toThrow(/isn't right/);
    expect(verifyLoginCode("ann@example.com", fresh, null).user.email).toBe("ann@example.com");
  });

  it("lets a second device request a code right after a successful sign-in", async () => {
    await requestLoginCode("ann@example.com", `c${client}`);
    verifyLoginCode("ann@example.com", lastCode("ann@example.com"), null);
    await expect(requestLoginCode("ann@example.com", `c${client}`)).resolves.toEqual({ email: "ann@example.com" });
  });

  it("signs out by ending the session", async () => {
    await requestLoginCode("ann@example.com", `c${client}`);
    const r = verifyLoginCode("ann@example.com", lastCode("ann@example.com"), null);
    endSession(r.token);
    expect(userForSessionToken(r.token)).toBeNull();
  });

  it("is off when no email transport is configured", async () => {
    delete process.env.INTERVIEW_AI_MODE;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_TRANSPORT;
    expect(authEnabled()).toBe(false);
    await expect(requestLoginCode("ann@example.com", `c${client}`)).rejects.toThrow(/isn't available/);
  });
});

describe("email delivery", () => {
  it("sends through Resend with the configured sender", async () => {
    const { sendEmail } = await import("@/lib/email");
    const { vi } = await import("vitest");
    delete process.env.INTERVIEW_AI_MODE;
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "TreTechPro <coach@tretechpro.ai>";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "e1" }), { status: 200 }));
    await sendEmail({ to: "ann@example.com", subject: "S", text: "T", html: "<p>T</p>" }, fetchMock as unknown as typeof fetch);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    expect(JSON.parse(init.body)).toMatchObject({ from: "TreTechPro <coach@tretechpro.ai>", to: ["ann@example.com"], subject: "S" });
    const failing = vi.fn().mockResolvedValue(new Response("bad", { status: 422 }));
    await expect(sendEmail({ to: "a@b.co", subject: "S", text: "T", html: "T" }, failing as unknown as typeof fetch)).rejects.toThrow(/could not be sent/);
  });
});
