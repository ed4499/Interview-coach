"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AnamVoice } from "@/lib/avatar";

const COUNTRY: Record<string, string> = { US: "American", GB: "British", AU: "Australian", CA: "Canadian", IE: "Irish", IN: "Indian", NZ: "New Zealand", ZA: "South African" };

export default function VoicePicker({ voices, currentId }: { voices: AnamVoice[]; currentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function choose(voiceId: string | null, name: string) {
    setBusy(voiceId ?? "reset");
    setMessage(null);
    const res = await fetch("/api/settings/interviewer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voiceId }) });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok || !data.saved) {
      setMessage({ ok: false, text: data.error ?? "The voice was not saved." });
      return;
    }
    setMessage({ ok: true, text: voiceId ? `Saved. New interviews will use “${name}”.` : "Reset to the default voice." });
    router.refresh();
  }

  return (
    <div className="stack">
      {message && (
        <p className={`alert small ${message.ok ? "ok" : "error"}`} role="status">
          {message.text}
        </p>
      )}
      <div className="voice-grid">
        {voices.map((v) => {
          const current = v.id === currentId;
          return (
            <div key={v.id} className={`card voice-card ${current ? "current" : ""}`}>
              <div className="spread">
                <strong>{v.displayName}</strong>
                {current && <span className="chip brand">Current voice</span>}
              </div>
              <div className="muted small">
                {[v.gender && v.gender.charAt(0) + v.gender.slice(1).toLowerCase(), v.country && (COUNTRY[v.country] ?? v.country)].filter(Boolean).join(" · ")}
              </div>
              {v.description && <p className="small" style={{ margin: "6px 0" }}>{v.description}</p>}
              {v.sampleUrl ? <audio controls preload="none" src={v.sampleUrl} style={{ width: "100%" }} /> : <p className="muted small">No sample available.</p>}
              {!current && (
                <button className="btn secondary small" style={{ marginTop: 8 }} disabled={!!busy} onClick={() => choose(v.id, v.displayName)}>
                  {busy === v.id ? "Saving…" : "Use this voice"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div>
        <button className="btn ghost small" disabled={!!busy} onClick={() => choose(null, "")}>
          Reset to default voice
        </button>
      </div>
    </div>
  );
}
