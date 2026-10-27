"use client";

import { useEffect, useRef, useState } from "react";
import { SPEECH_LEVEL, levelMeter, listMics, openMic, saveMicId } from "./mic";

/** Microphone picker with a live level meter so candidates can confirm they're being heard. */
export default function MicSetup({
  deviceId,
  onDeviceChange,
  onReady,
}: {
  deviceId: string | null;
  onDeviceChange: (id: string | null) => void;
  /** Called once microphone permission is granted and the mic is open. */
  onReady?: () => void;
}) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeId = useRef<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let meter: ReturnType<typeof levelMeter> | null = null;
    let raf = 0;
    let cancelled = false;
    setHeard(false);
    (async () => {
      try {
        stream = await openMic(deviceId);
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        setError(null);
        onReady?.();
        // Device labels are only available after permission is granted.
        const list = await listMics();
        if (cancelled) return;
        setMics(list);
        activeId.current = stream.getAudioTracks()[0]?.getSettings().deviceId ?? null;
        if (!deviceId && activeId.current) onDeviceChange(activeId.current);
        meter = levelMeter(stream);
        const tick = () => {
          const l = meter!.read();
          setLevel(l);
          if (l > SPEECH_LEVEL) setHeard(true);
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        setError(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Microphone access is blocked. Click the lock or camera icon in the address bar, allow the microphone for this site, then reload."
            : "No microphone could be opened. Check that one is connected and not in use by another app.",
        );
      }
    })();
    const onDevices = () => listMics().then(setMics).catch(() => {});
    navigator.mediaDevices?.addEventListener("devicechange", onDevices);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      meter?.close();
      stream?.getTracks().forEach((t) => t.stop());
      navigator.mediaDevices?.removeEventListener("devicechange", onDevices);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const value = deviceId ?? activeId.current ?? "";
  return (
    <div className="mic-setup">
      <label htmlFor="mic-select">Microphone</label>
      <select
        id="mic-select"
        value={mics.some((m) => m.deviceId === value) ? value : ""}
        onChange={(e) => {
          const id = e.target.value || null;
          saveMicId(id);
          onDeviceChange(id);
        }}
      >
        {!mics.some((m) => m.deviceId === value) && <option value="">Default microphone</option>}
        {mics.map((m, i) => (
          <option key={m.deviceId} value={m.deviceId}>
            {m.label || `Microphone ${i + 1}`}
          </option>
        ))}
      </select>
      <div className="mic-meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
        <span style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
      <p className={`hint ${heard ? "status-good" : ""}`} style={{ marginTop: 4 }}>
        {error ?? (heard ? "✓ We can hear you." : "Say something: the bar should move. If it doesn't, pick a different microphone.")}
      </p>
    </div>
  );
}
