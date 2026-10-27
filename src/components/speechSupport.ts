"use client";

/**
 * Spoken answers rely on the browser's speech-to-text, which only works reliably in
 * Google Chrome and Microsoft Edge. Some browsers (e.g. Opera, Brave) expose the API but
 * can't reach a transcription service, so we probe it before the interview starts.
 */

export type SpeechSupport = "checking" | "ok" | "unavailable" | "blocked";

export function browserName(): string {
  if (typeof navigator === "undefined") return "this browser";
  const ua = navigator.userAgent;
  if ((navigator as unknown as { brave?: unknown }).brave) return "Brave";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Edg\//.test(ua)) return "Microsoft Edge";
  if (/Vivaldi/.test(ua)) return "Vivaldi";
  if (/SamsungBrowser/.test(ua)) return "Samsung Internet";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Google Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "this browser";
}

/** Browsers we recommend for spoken answers. */
export function isRecommendedBrowser(): boolean {
  const name = browserName();
  return name === "Google Chrome" || name === "Microsoft Edge";
}

type Recognizer = { lang: string; start(): void; stop(): void; abort?: () => void; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };

/** Briefly starts speech recognition and reports whether the browser's service works. */
export function probeSpeechRecognition(timeoutMs = 3000): Promise<Exclude<SpeechSupport, "checking">> {
  const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return Promise.resolve("unavailable");
  return new Promise((resolve) => {
    let settled = false;
    const sr = new Ctor();
    const done = (r: Exclude<SpeechSupport, "checking">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        (sr.abort ?? sr.stop).call(sr);
      } catch {}
      resolve(r);
    };
    sr.lang = "en-US";
    sr.onerror = (e) => {
      if (e.error === "network" || e.error === "service-not-allowed" || e.error === "language-not-supported") done("unavailable");
      else if (e.error === "not-allowed") done("blocked");
    };
    const timer = setTimeout(() => done("ok"), timeoutMs);
    try {
      sr.start();
    } catch {
      done("unavailable");
    }
  });
}
