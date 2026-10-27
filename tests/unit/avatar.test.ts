import { afterEach, describe, expect, it, vi } from "vitest";
import { AvatarUnavailableError, avatarClientConfig, createAnamSessionToken } from "@/lib/avatar";
import { closingLine, introLine, questionLine } from "@/lib/interviewerScript";

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

describe("Anam session tokens", () => {
  it("requests a persona that only speaks our text and keeps no recordings", async () => {
    process.env.ANAM_API_KEY = "test-key";
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

  it("selects the interviewer provider", () => {
    delete process.env.ANAM_API_KEY;
    delete process.env.INTERVIEW_AI_MODE;
    delete process.env.AVATAR_PROVIDER;
    expect(avatarClientConfig().provider).toBe("browser");
    process.env.ANAM_API_KEY = "k";
    expect(avatarClientConfig()).toMatchObject({ provider: "anam", idleMs: 0, interviewerName: "Cara" });
    process.env.AVATAR_IDLE_SECONDS = "3600";
    expect(avatarClientConfig().idleMs).toBe(3_600_000);
    process.env.INTERVIEW_AI_MODE = "test";
    expect(avatarClientConfig().provider).toBe("test");
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
