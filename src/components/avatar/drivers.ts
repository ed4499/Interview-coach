"use client";

/**
 * Interviewer "drivers": each one makes the interviewer say a line and resolves when it
 * has finished speaking. The interview UI only talks to this interface, so the Anam video
 * avatar can be swapped for another provider without touching the screens.
 */
import type { AvatarProvider } from "@/lib/avatar";

export type AvatarState = "idle" | "connecting" | "speaking" | "listening" | "error";

export interface AvatarDriver {
  readonly kind: AvatarProvider;
  /** Optional warm-up (e.g. connect the video stream before the next line). */
  prepare(): void;
  /** Speak a line; resolves when speech has finished (or failed; never hangs). */
  say(text: string): Promise<void>;
  /** Stop speaking immediately. */
  interrupt(): void;
  setMuted(muted: boolean): void;
  destroy(): void;
}

export interface DriverCallbacks {
  onState: (s: AvatarState) => void;
  /** Called with a still image of the last video frame when the live stream disconnects. */
  onFreezeFrame?: (dataUrl: string | null) => void;
  /** Whether live interviewer video is currently playing. */
  onLiveChange?: (live: boolean) => void;
  /** Called once if the video interviewer fails and the UI should fall back to voice only. */
  onFatal?: (message: string) => void;
}

/** Upper bound for one line: generous speaking time, then give up waiting. */
function speechDeadlineMs(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(8000, (words / 2.2) * 1000 + 8000);
}

// ---------------------------------------------------------------------------
// Test driver (INTERVIEW_AI_MODE=test): instant, silent, deterministic.

export class TestDriver implements AvatarDriver {
  readonly kind = "test" as const;
  constructor(private cb: DriverCallbacks) {}
  prepare() {}
  async say() {
    this.cb.onState("speaking");
    await new Promise((r) => setTimeout(r, 150));
    this.cb.onState("listening");
  }
  interrupt() {}
  setMuted() {}
  destroy() {}
}

// ---------------------------------------------------------------------------
// Browser voice (fallback when no video avatar is configured or it fails).

export class BrowserVoiceDriver implements AvatarDriver {
  readonly kind = "browser" as const;
  private muted = false;
  private finish: (() => void) | null = null;
  constructor(private cb: DriverCallbacks) {}

  private pickVoice(): SpeechSynthesisVoice | undefined {
    const voices = window.speechSynthesis?.getVoices() ?? [];
    const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
    return (
      en.find((v) => /natural|neural|online/i.test(v.name)) ??
      en.find((v) => /google us english|samantha|aria|jenny/i.test(v.name)) ??
      en.find((v) => v.lang === "en-US") ??
      en[0]
    );
  }

  prepare() {
    window.speechSynthesis?.getVoices(); // triggers async voice loading in some browsers
  }

  say(text: string): Promise<void> {
    this.interrupt();
    this.cb.onState("speaking");
    return new Promise<void>((resolve) => {
      const done = () => {
        if (this.finish !== done) return;
        this.finish = null;
        clearTimeout(timer);
        this.cb.onState("listening");
        resolve();
      };
      this.finish = done;
      const timer = setTimeout(done, speechDeadlineMs(text));
      const synth = window.speechSynthesis;
      if (!synth || this.muted) {
        setTimeout(done, this.muted ? 600 : 0);
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      const v = this.pickVoice();
      if (v) u.voice = v;
      u.rate = 1;
      u.onend = done;
      u.onerror = done;
      synth.speak(u);
    });
  }

  interrupt() {
    window.speechSynthesis?.cancel();
    this.finish?.();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) window.speechSynthesis?.cancel();
  }

  destroy() {
    this.interrupt();
  }
}

// ---------------------------------------------------------------------------
// Anam realistic video avatar.

type AnamModule = typeof import("@anam-ai/js-sdk");
type AnamClient = ReturnType<AnamModule["createClient"]>;

export class AnamDriver implements AvatarDriver {
  readonly kind = "anam" as const;
  private client: AnamClient | null = null;
  private connecting: Promise<AnamClient> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private muted = false;
  private destroyed = false;

  // Speech-end detection: the persona's endOfSpeech event plus the audio level.
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private personaEnded = false;
  private heardAudio = false;
  private lastLoudAt = 0;
  private finish: (() => void) | null = null;

  constructor(
    private videoElementId: string,
    private fetchToken: () => Promise<string>,
    private idleMs: number,
    private cb: DriverCallbacks,
  ) {}

  private video(): HTMLVideoElement | null {
    return document.getElementById(this.videoElementId) as HTMLVideoElement | null;
  }

  prepare() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.connect().catch(() => {});
  }

  private connect(): Promise<AnamClient> {
    if (this.client?.isStreaming()) return Promise.resolve(this.client);
    if (this.connecting) return this.connecting;
    this.cb.onState("connecting");
    this.connecting = (async () => {
      const { createClient, AnamEvent, MessageRole } = await import("@anam-ai/js-sdk");
      const token = await this.fetchToken();
      // Our app captures the candidate's microphone itself; Anam never listens.
      const client = createClient(token, { disableInputAudio: true });
      const ready = new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("The video interviewer took too long to connect.")), 20000);
        client.addListener(AnamEvent.VIDEO_PLAY_STARTED, () => {
          clearTimeout(t);
          resolve();
        });
        client.addListener(AnamEvent.CONNECTION_CLOSED, (reason, details) => {
          clearTimeout(t);
          reject(new Error(`Video connection closed (${reason}${details ? `: ${details}` : ""})`));
        });
      });
      client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (e) => {
        if (e.role === MessageRole.PERSONA && e.endOfSpeech) this.personaEnded = true;
      });
      client.addListener(AnamEvent.AUDIO_STREAM_STARTED, (stream) => this.watchAudio(stream));
      client.addListener(AnamEvent.CONNECTION_CLOSED, () => {
        if (this.client === client) {
          this.client = null;
          this.cb.onLiveChange?.(false);
        }
        this.finish?.();
      });
      await client.streamToVideoElement(this.videoElementId);
      await ready;
      const v = this.video();
      if (v) v.muted = this.muted;
      this.client = client;
      this.cb.onFreezeFrame?.(null);
      this.cb.onLiveChange?.(true);
      return client;
    })();
    this.connecting
      .catch(() => {})
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  private watchAudio(stream: MediaStream) {
    try {
      this.audioCtx ??= new AudioContext();
      void this.audioCtx.resume();
      const src = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
    } catch {
      this.analyser = null; // fall back to events + deadline
    }
  }

  private level(): number {
    if (!this.analyser) return 0;
    const buf = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const b of buf) sum += (b - 128) * (b - 128);
    return Math.sqrt(sum / buf.length) / 128;
  }

  async say(text: string): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    let client: AnamClient;
    try {
      client = await this.connect().catch(() => this.connect()); // one retry for transient failures
    } catch (err) {
      this.fail(err);
      return;
    }
    this.personaEnded = false;
    this.heardAudio = false;
    this.lastLoudAt = Date.now();
    this.cb.onState("speaking");
    const started = Date.now();
    const deadline = started + speechDeadlineMs(text);

    await new Promise<void>((resolve) => {
      const done = () => {
        if (this.finish !== done) return;
        this.finish = null;
        clearInterval(poll);
        resolve();
      };
      this.finish = done;
      const poll = setInterval(() => {
        const now = Date.now();
        if (this.level() > 0.02) {
          this.heardAudio = true;
          this.lastLoudAt = now;
        }
        const quietFor = now - this.lastLoudAt;
        if (
          now > deadline ||
          (this.personaEnded && quietFor > 700) ||
          (this.heardAudio && quietFor > 2200) ||
          // No audio analysis available: rely on the end-of-speech event.
          (!this.analyser && this.personaEnded && now - started > 1500)
        ) {
          done();
        }
      }, 100);
      client.talk(text).catch((err) => {
        console.warn("[avatar] talk failed:", err);
        done();
      });
    });

    if (this.destroyed) return;
    this.cb.onState("listening");
    this.scheduleIdleDisconnect();
  }

  private scheduleIdleDisconnect() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.disconnect(), this.idleMs);
  }

  /** Ends the billed live session, leaving the last frame on screen (interviewer "listening"). */
  private async disconnect() {
    const client = this.client;
    if (!client) return;
    this.cb.onFreezeFrame?.(this.captureFrame());
    this.cb.onLiveChange?.(false);
    this.client = null;
    await client.stopStreaming().catch(() => {});
  }

  private captureFrame(): string | null {
    const v = this.video();
    if (!v || !v.videoWidth) return null;
    try {
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext("2d")?.drawImage(v, 0, 0);
      return c.toDataURL("image/jpeg", 0.85);
    } catch {
      return null;
    }
  }

  /** The UI switches to the voice-only fallback and repeats the line, so the interview never stalls. */
  private fail(err: unknown) {
    console.warn("[avatar] video interviewer error:", err);
    this.cb.onState("error");
    this.cb.onFatal?.(err instanceof Error ? err.message : String(err));
  }

  interrupt() {
    try {
      this.client?.interruptPersona();
    } catch {}
    this.finish?.();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    const v = this.video();
    if (v) v.muted = muted;
  }

  destroy() {
    this.destroyed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.finish?.();
    void this.client?.stopStreaming().catch(() => {});
    this.client = null;
    void this.audioCtx?.close().catch(() => {});
  }
}
