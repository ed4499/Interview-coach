/**
 * Hands-free answer timing: after the candidate has spoken, a pause longer than
 * `silenceMs` starts a visible countdown; any new speech cancels it; when it reaches
 * zero the answer is submitted. A brief thinking pause therefore never cuts anyone off.
 */
export interface HandsFreeOptions {
  silenceMs: number;
  countdownMs: number;
}

export const DEFAULT_HANDS_FREE: HandsFreeOptions = { silenceMs: 3500, countdownMs: 3000 };

export type HandsFreePhase =
  | { phase: "waiting" } // listening, nothing said yet
  | { phase: "speaking" }
  | { phase: "countdown"; remainingMs: number }
  | { phase: "submit" };

export class HandsFreeTimer {
  private lastSpeechAt: number | null = null;
  private paused = false;

  constructor(private opts: HandsFreeOptions = DEFAULT_HANDS_FREE) {}

  /** Call whenever speech is recognized (interim or final results). */
  speech(now: number) {
    this.lastSpeechAt = now;
    this.paused = false;
  }

  /** "Not done yet": treat now as speech so the full silence window restarts. */
  extend(now: number) {
    this.speech(now);
  }

  /** Manual stop without submitting (e.g. the candidate wants to edit). */
  pause() {
    this.paused = true;
  }

  state(now: number): HandsFreePhase {
    if (this.lastSpeechAt === null || this.paused) return { phase: "waiting" };
    const quiet = now - this.lastSpeechAt;
    if (quiet < this.opts.silenceMs) return { phase: "speaking" };
    const remainingMs = this.opts.silenceMs + this.opts.countdownMs - quiet;
    return remainingMs > 0 ? { phase: "countdown", remainingMs } : { phase: "submit" };
  }
}
