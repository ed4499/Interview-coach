"use client";

/** Microphone helpers shared by the mic picker and the answer recorder. */

const STORAGE_KEY = "ttp_mic_device";

/** The candidate's chosen microphone, remembered per browser (a convenience, not app data). */
export function loadMicId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveMicId(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/** Opens the chosen microphone, falling back to the default one if it has disappeared. */
export async function openMic(deviceId: string | null | undefined): Promise<MediaStream> {
  const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: deviceId } } });
    } catch (err) {
      if (!(err instanceof DOMException) || err.name !== "OverconstrainedError") throw err;
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: base });
}

export async function listMics(): Promise<MediaDeviceInfo[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "audioinput" && d.deviceId);
}

/** Live input level (0..1) of a stream, for meters and voice-activity checks. */
export function levelMeter(stream: MediaStream): { read: () => number; close: () => void } {
  try {
    const ctx = new AudioContext();
    void ctx.resume();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    return {
      read() {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const b of buf) sum += (b - 128) * (b - 128);
        return Math.min(1, (Math.sqrt(sum / buf.length) / 128) * 4);
      },
      close() {
        void ctx.close().catch(() => {});
      },
    };
  } catch {
    return { read: () => 0, close() {} };
  }
}

/** Level above which we treat the input as the candidate speaking. */
export const SPEECH_LEVEL = 0.12;
