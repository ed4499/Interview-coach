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
import { getSetting } from "./settings";

export type AvatarProvider = "anam" | "browser" | "test";

export interface AvatarClientConfig {
  provider: AvatarProvider;
  interviewerName: string;
  /** How long the live video stays connected after speaking before disconnecting. */
  idleMs: number;
  /** Anam's natural idling loop for this avatar, shown while the live stream is disconnected. */
  idleVideoUrl: string | null;
  posterUrl: string | null;
}

export const VOICE_SETTING = "anam_voice_id";
const ANAM_API = "https://api.anam.ai";

// Defaults from Anam's documented example persona ("Cara"); override with your own avatar/voice.
const DEFAULT_AVATAR_ID = "30fa96d0-26c4-4e55-94a0-517025942e18";
// "Julia" from Anam's standard voices, chosen to replace the docs' example voice "Cara" (British).
// Change it on the Interviewer settings page or with ANAM_VOICE_ID.
const DEFAULT_VOICE_ID = "109ecf2e-93c4-40df-9555-328c4a5f0c97";

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && process.env[name] !== "" && process.env[name] !== undefined ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

export function avatarId(): string {
  return process.env.ANAM_AVATAR_ID || DEFAULT_AVATAR_ID;
}

/** Voice explicitly chosen on the Interviewer settings page, else ANAM_VOICE_ID (null if neither). */
export function configuredVoiceId(): string | null {
  return getSetting(VOICE_SETTING) || process.env.ANAM_VOICE_ID || null;
}

export type VoiceSource = "chosen" | "default";

/** The voice used for new sessions: the one chosen in settings or the environment, else the app default. */
export async function resolveVoiceId(): Promise<{ id: string; source: VoiceSource }> {
  const configured = configuredVoiceId();
  return configured ? { id: configured, source: "chosen" } : { id: DEFAULT_VOICE_ID, source: "default" };
}

async function anamGet<T>(path: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const key = process.env.ANAM_API_KEY;
  if (!key) throw new AvatarUnavailableError("ANAM_API_KEY is not set.");
  const res = await fetchImpl(`${ANAM_API}${path}`, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
  if (!res.ok) throw new AvatarUnavailableError(`Anam ${path} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}

interface AnamAvatar {
  imageUrl?: string | null;
  idleVideoUrl?: string | null;
  videoUrl?: string | null;
}

// Signed idle-video URLs expire after an hour; refresh well before that.
let mediaCache: { avatarId: string; at: number; media: { idleVideoUrl: string | null; posterUrl: string | null } } | null = null;
const MEDIA_TTL_MS = 30 * 60_000;

export async function avatarMedia(fetchImpl: typeof fetch = fetch): Promise<{ idleVideoUrl: string | null; posterUrl: string | null }> {
  const id = avatarId();
  if (mediaCache && mediaCache.avatarId === id && Date.now() - mediaCache.at < MEDIA_TTL_MS) return mediaCache.media;
  try {
    const a = await anamGet<AnamAvatar>(`/v1/avatars/${encodeURIComponent(id)}`, fetchImpl);
    const media = { idleVideoUrl: a.idleVideoUrl ?? a.videoUrl ?? null, posterUrl: a.imageUrl ?? null };
    mediaCache = { avatarId: id, at: Date.now(), media };
    return media;
  } catch (err) {
    console.warn("[avatar] could not load avatar idle media:", err);
    return { idleVideoUrl: null, posterUrl: null };
  }
}

export interface AnamVoice {
  id: string;
  displayName: string;
  gender: string | null;
  country: string | null;
  description: string | null;
  sampleUrl: string | null;
  displayTags: string[];
}

/** All voices available to this Anam account (paginated API, capped at 1,000). */
export async function listAnamVoices(fetchImpl: typeof fetch = fetch): Promise<AnamVoice[]> {
  const out: AnamVoice[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await anamGet<{ data: AnamVoice[]; meta?: { lastPage?: number } }>(`/v1/voices?perPage=100&page=${page}`, fetchImpl);
    out.push(...r.data);
    if (!r.meta?.lastPage || page >= r.meta.lastPage) break;
  }
  return out;
}

export async function getAnamVoice(id: string, fetchImpl: typeof fetch = fetch): Promise<AnamVoice> {
  return anamGet<AnamVoice>(`/v1/voices/${encodeURIComponent(id)}`, fetchImpl);
}

/** Test hook. */
export function resetAvatarMediaCache() {
  mediaCache = null;
}

export async function avatarClientConfig(): Promise<AvatarClientConfig> {
  const forced = process.env.AVATAR_PROVIDER as AvatarProvider | undefined;
  const provider: AvatarProvider =
    forced === "anam" || forced === "browser" || forced === "test" ? forced : isTestMode() ? "test" : process.env.ANAM_API_KEY ? "anam" : "browser";
  const media = provider === "anam" ? await avatarMedia() : { idleVideoUrl: null, posterUrl: null };
  return {
    provider,
    interviewerName: process.env.INTERVIEWER_NAME?.trim() || "Cara",
    idleMs: intEnv("AVATAR_IDLE_SECONDS", 0, 0, 7200) * 1000,
    ...media,
  };
}

export class AvatarUnavailableError extends Error {}

export function anamSessionRequest(voice: string) {
  return {
    clientLabel: "tretechpro-interview-coach",
    personaConfig: {
      name: process.env.INTERVIEWER_NAME?.trim() || "Cara",
      avatarId: avatarId(),
      avatarModel: process.env.ANAM_AVATAR_MODEL || "cara-4",
      voiceId: voice,
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
    body: JSON.stringify(anamSessionRequest((await resolveVoiceId()).id)),
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
