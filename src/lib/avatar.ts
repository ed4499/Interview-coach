/**
 * Video interviewer configuration and Anam (anam.ai) session tokens.
 *
 * The avatar only ever speaks text this app sends it (llmId CUSTOMER_CLIENT_V1 disables
 * Anam's own LLM, and the browser SDK runs with input audio disabled), so the interview
 * stays exactly as configured: the bank's questions, our follow-ups, our scoring.
 *
 * Anam bills per second while a session is open, and smaller plans cap session length,
 * so by default the avatar connects to ask each question and disconnects while the
 * candidate answers (AVATAR_IDLE_SECONDS=0). On plans with long sessions, set
 * AVATAR_IDLE_SECONDS high (e.g. 3600) to keep one live session for the whole interview.
 */
import { isTestMode } from "./ai";

export type AvatarProvider = "anam" | "browser" | "test";

export interface AvatarClientConfig {
  provider: AvatarProvider;
  interviewerName: string;
  /** How long the live video stays connected after speaking before disconnecting. */
  idleMs: number;
}

// Defaults from Anam's documented example persona ("Cara"); override with your own avatar/voice.
const DEFAULT_AVATAR_ID = "30fa96d0-26c4-4e55-94a0-517025942e18";
const DEFAULT_VOICE_ID = "6bfbe25a-979d-40f3-a92b-5394170af54b";

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && process.env[name] !== "" && process.env[name] !== undefined ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

export function avatarClientConfig(): AvatarClientConfig {
  const forced = process.env.AVATAR_PROVIDER as AvatarProvider | undefined;
  const provider: AvatarProvider =
    forced === "anam" || forced === "browser" || forced === "test" ? forced : isTestMode() ? "test" : process.env.ANAM_API_KEY ? "anam" : "browser";
  return {
    provider,
    interviewerName: process.env.INTERVIEWER_NAME?.trim() || "Cara",
    idleMs: intEnv("AVATAR_IDLE_SECONDS", 0, 0, 7200) * 1000,
  };
}

export class AvatarUnavailableError extends Error {}

export function anamSessionRequest() {
  return {
    clientLabel: "tretechpro-interview-coach",
    personaConfig: {
      name: process.env.INTERVIEWER_NAME?.trim() || "Cara",
      avatarId: process.env.ANAM_AVATAR_ID || DEFAULT_AVATAR_ID,
      avatarModel: process.env.ANAM_AVATAR_MODEL || "cara-4",
      voiceId: process.env.ANAM_VOICE_ID || DEFAULT_VOICE_ID,
      // Disables Anam's built-in LLM: the persona only says what talk() sends.
      llmId: "CUSTOMER_CLIENT_V1",
      skipGreeting: true,
      // Caps billing if a browser tab is left open; must fit the Anam plan's session limit.
      maxSessionLengthSeconds: intEnv("AVATAR_MAX_SESSION_SECONDS", 180, 30, 7200),
    },
    sessionOptions: {
      // Candidates' interviews are private: don't let Anam keep recordings or transcripts.
      dataRetention: { recording: false, transcripts: false },
    },
  };
}

export async function createAnamSessionToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  const key = process.env.ANAM_API_KEY;
  if (!key) throw new AvatarUnavailableError("The video interviewer is not configured (ANAM_API_KEY is missing).");
  const res = await fetchImpl("https://api.anam.ai/v1/auth/session-token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(anamSessionRequest()),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    console.error(`[avatar] Anam session token request failed: HTTP ${res.status} ${detail}`);
    throw new AvatarUnavailableError(`The video interviewer could not start (Anam HTTP ${res.status}).`);
  }
  const data = (await res.json()) as { sessionToken?: string };
  if (!data.sessionToken) throw new AvatarUnavailableError("The video interviewer could not start (no session token).");
  return data.sessionToken;
}
