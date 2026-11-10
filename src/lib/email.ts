/**
 * Transactional email (sign-in codes) via Resend's REST API. In test mode, or when
 * EMAIL_TRANSPORT=outbox, messages are stored in the dev_outbox table instead of sent.
 */
import { isTestMode } from "./ai";
import { getDb } from "./db";

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function emailTransport(): "resend" | "outbox" | null {
  if (process.env.EMAIL_TRANSPORT === "outbox" || isTestMode()) return "outbox";
  return process.env.RESEND_API_KEY ? "resend" : null;
}

export class EmailError extends Error {}

export async function sendEmail(msg: Email, fetchImpl: typeof fetch = fetch): Promise<void> {
  const transport = emailTransport();
  if (transport === "outbox") {
    getDb().prepare(`INSERT INTO dev_outbox (to_email, subject, text, created_at) VALUES (?, ?, ?, ?)`).run(msg.to, msg.subject, msg.text, new Date().toISOString());
    return;
  }
  if (transport !== "resend") throw new EmailError("Email sending is not configured.");
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "TreTechPro <no-reply@tretechpro.ai>",
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    console.error(`[email] Resend rejected the message: HTTP ${res.status} ${detail}`);
    throw new EmailError("The sign-in email could not be sent. Please try again in a minute.");
  }
}
