import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AvatarUnavailableError,
  VOICE_SETTING,
  avatarClientConfig,
  avatarMedia,
  configuredVoiceId,
  createAnamSessionToken,
  pickAmericanVoice,
  resetAvatarMediaCache,
  resolveVoiceId,
} from "@/lib/avatar";
import { setSetting } from "@/lib/settings";
import { freshEnv } from "./helpers";
import { closingLine, introLine, questionLine } from "@/lib/interviewerScript";

const ENV = { ...process.env };
beforeEach(() => {
  freshEnv();
  resetAvatarMediaCache();
});
afterEach(() => {
  process.env = { ...ENV };
});

describe("Anam session tokens", () => {
  it("requests a persona that only speaks our text and keeps no recordings", async () => {
    process.env.ANAM_API_KEY = "test-key";
    process.env.ANAM_VOICE_ID = "11111111-1111-1111-1111-111111111111";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessionToken: "jwt" }), { status: 200 }));
    expect(await createAnamSessionToken(fetchMock as unknown as typeof fetch)).toBe("jwt");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anam.ai/v1/auth/session-token");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body);
    expect(body.personaConfig).toMatchObject({ llmId: "CUSTOMER_CLIENT_V1", skipGreeting: true, maxSessionLengthSeconds: 180, avatarModel: "cara-4" });
    expect(body.personaConfig.avatarId).toBeTruthy();
    expect(body.personaConfig.voiceId).toBeTruthy();
    expect(body.sessionOptions.dataRetention).toEqual({ recording: false, transcripts: false });
  });

  it("uses configured avatar, voice, name and session cap", async () => {
    Object.assign(process.env, { ANAM_API_KEY: "k", ANAM_AVATAR_ID: "av", ANAM_VOICE_ID: "vo", INTERVIEWER_NAME: "Jordan", AVATAR_MAX_SESSION_SECONDS: "600" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessionToken: "t" })));
    await createAnamSessionToken(fetchMock as unknown as typeof fetch);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).personaConfig).toMatchObject({ avatarId: "av", voiceId: "vo", name: "Jordan", maxSessionLengthSeconds: 600 });
  });

  it("fails clearly without a key or when Anam rejects the request", async () => {
    delete process.env.ANAM_API_KEY;
    await expect(createAnamSessionToken(vi.fn() as unknown as typeof fetch)).rejects.toThrow(AvatarUnavailableError);
    process.env.ANAM_API_KEY = "bad";
    const fetchMock = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    await expect(createAnamSessionToken(fetchMock as unknown as typeof fetch)).rejects.toThrow(/HTTP 401/);
  });

  it("selects the interviewer provider", async () => {
    delete process.env.ANAM_API_KEY;
    delete process.env.INTERVIEW_AI_MODE;
    delete process.env.AVATAR_PROVIDER;
    expect((await avatarClientConfig()).provider).toBe("browser");
    process.env.INTERVIEW_AI_MODE = "test";
    expect(await avatarClientConfig()).toMatchObject({ provider: "test", idleMs: 0, interviewerName: "Cara", idleVideoUrl: null });
    process.env.AVATAR_IDLE_SECONDS = "3600";
    expect((await avatarClientConfig()).idleMs).toBe(3_600_000);
  });

  it("uses the voice chosen in settings, then ANAM_VOICE_ID", () => {
    delete process.env.ANAM_VOICE_ID;
    expect(configuredVoiceId()).toBeNull();
    process.env.ANAM_VOICE_ID = "env-voice";
    expect(configuredVoiceId()).toBe("env-voice");
    setSetting(VOICE_SETTING, "chosen-voice");
    expect(configuredVoiceId()).toBe("chosen-voice");
  });

  it("defaults to an American voice when none is configured", async () => {
    delete process.env.ANAM_VOICE_ID;
    process.env.ANAM_API_KEY = "k";
    const voices = [
      { id: "gb-f", displayName: "Amelia", gender: "FEMALE", country: "GB" },
      { id: "us-m", displayName: "Adam", gender: "MALE", country: "US" },
      { id: "us-f", displayName: "Sarah", gender: "FEMALE", country: "US" },
    ];
    expect(pickAmericanVoice(voices as never)?.id).toBe("us-f");
    expect(pickAmericanVoice([voices[0], voices[1]] as never)?.id).toBe("us-m");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: voices, meta: { lastPage: 1 } })));
    expect(await resolveVoiceId(fetchMock as unknown as typeof fetch)).toEqual({ id: "us-f", source: "auto-american" });
    await resolveVoiceId(fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1); // cached
    setSetting(VOICE_SETTING, "chosen");
    expect(await resolveVoiceId(fetchMock as unknown as typeof fetch)).toEqual({ id: "chosen", source: "chosen" });
  });

  it("reports the British default honestly when Anam labels no voice as American", async () => {
    delete process.env.ANAM_VOICE_ID;
    process.env.ANAM_API_KEY = "k";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "x", displayName: "X", country: null }], meta: { lastPage: 1 } })));
    expect(await resolveVoiceId(fetchMock as unknown as typeof fetch)).toEqual({ id: "6bfbe25a-979d-40f3-a92b-5394170af54b", source: "default" });
  });

  it("offers Anam's stock voices even when the API omits them", async () => {
    const { mergeVoices, STOCK_VOICES } = await import("@/lib/anamVoiceCatalog");
    const merged = mergeVoices([{ id: "api-1", displayName: "Api", gender: "FEMALE", country: "US", description: null, sampleUrl: null, displayTags: [] }]);
    expect(merged).toHaveLength(STOCK_VOICES.length + 1);
    expect(merged.find((v) => v.displayName === "Cara")?.country).toBe("GB");
    expect(STOCK_VOICES.every((v) => v.sampleUrl?.startsWith("https://lab.anam.ai/voice_samples/"))).toBe(true);
  });

  it("loads the avatar's idle loop and caches the signed URL", async () => {
    process.env.ANAM_API_KEY = "k";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ idleVideoUrl: "https://cdn/idle.mp4", imageUrl: "https://cdn/poster.jpg" })));
    expect(await avatarMedia(fetchMock as unknown as typeof fetch)).toEqual({ idleVideoUrl: "https://cdn/idle.mp4", posterUrl: "https://cdn/poster.jpg" });
    await avatarMedia(fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/^https:\/\/api\.anam\.ai\/v1\/avatars\//);
  });

  it("falls back to no idle video if Anam is unreachable", async () => {
    process.env.ANAM_API_KEY = "k";
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    expect(await avatarMedia(fetchMock as unknown as typeof fetch)).toEqual({ idleVideoUrl: null, posterUrl: null });
  });
});

describe("interviewer script", () => {
  const q = "Tell me about a time you solved a difficult problem.";

  it("reads questions verbatim and introduces each section once", () => {
    const first = questionLine({ position: 1, text: q, category: "behavioral", previousCategory: null });
    expect(first).toContain(q);
    expect(first).toMatch(/behavioral questions/);
    const same = questionLine({ position: 2, text: q, category: "behavioral", previousCategory: "behavioral" });
    expect(same).not.toMatch(/behavioral questions/);
    expect(same.endsWith(q)).toBe(true);
    expect(questionLine({ position: 6, text: q, category: "technical_knowledge", previousCategory: "behavioral" })).toMatch(/technical knowledge questions/);
  });

  it("stays neutral between questions (no praise or judgement before scoring)", () => {
    for (let p = 2; p <= 15; p++) {
      const line = questionLine({ position: p, text: q, category: "behavioral", previousCategory: "behavioral" });
      expect(line).not.toMatch(/great|excellent|good answer|perfect|wrong|impressive/i);
    }
  });

  it("introduces, resumes and closes the interview", () => {
    expect(introLine({ name: "Cara", role: "SOC Analyst", total: 15, resuming: false, position: 1 })).toMatch(/I'm Cara.*SOC Analyst.*15 questions/);
    expect(introLine({ name: "Cara", role: "SOC Analyst", total: 15, resuming: true, position: 7 })).toMatch(/question 7 of 15/);
    expect(closingLine(true)).toMatch(/out of time/);
  });
});
