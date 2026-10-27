"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { browserName, isRecommendedBrowser } from "./speechSupport";

interface Props {
  roles: string[];
  levels: { value: string; label: string; hint: string }[];
  modes: { value: string; label: string }[];
}

export default function SetupForm({ roles, levels, modes }: Props) {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [level, setLevel] = useState("");
  const [mode, setMode] = useState("full");
  const [responseMode, setResponseMode] = useState<"text" | "voice">("text");
  const [consent, setConsent] = useState(false);
  const [timed, setTimed] = useState(false);
  const [minutes, setMinutes] = useState(45);
  const [jd, setJd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browserWarning, setBrowserWarning] = useState<string | null>(null);
  useEffect(() => setBrowserWarning(isRecommendedBrowser() ? null : browserName()), []);

  const ready = role && level && (responseMode === "text" || consent);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role,
          experience_level: level,
          interview_mode: mode,
          response_mode: responseMode,
          consent_to_audio_recording: responseMode === "voice" && consent,
          time_limit_minutes: timed ? minutes : null,
          target_job_description: jd || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.session_id) throw new Error(data.error ?? "Could not create the interview.");
      router.push(`/interview/${data.session_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={start}>
      <div className="field">
        <label htmlFor="role">Target career role</label>
        <select id="role" value={role} onChange={(e) => setRole(e.target.value)} required>
          <option value="">Select a role…</option>
          {roles.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </div>

      <fieldset className="field">
        <legend>Experience level</legend>
        <div className="choices">
          {levels.map((l) => (
            <label key={l.value} className="choice">
              <input type="radio" name="level" value={l.value} checked={level === l.value} onChange={() => setLevel(l.value)} required />
              {l.label}
              <p className="hint">{l.hint}</p>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>Interview type</legend>
        <div className="choices">
          {modes.map((m) => (
            <label key={m.value} className="choice">
              <input type="radio" name="mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>How will you answer?</legend>
        <div className="choices">
          <label className="choice">
            <input type="radio" name="rm" checked={responseMode === "text"} onChange={() => setResponseMode("text")} />
            Type my answers
          </label>
          <label className="choice">
            <input type="radio" name="rm" checked={responseMode === "voice"} onChange={() => setResponseMode("voice")} />
            Speak my answers
            <p className="hint">Recorded and transcribed; you can edit the transcript before submitting.</p>
          </label>
        </div>
        {responseMode === "voice" && browserWarning && (
          <p className="alert small" style={{ marginTop: 12 }}>
            Spoken answers work best in <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong>. You&apos;re using {browserWarning}, which may not be
            able to transcribe speech; if so, you can still type your answers.
          </p>
        )}
        {responseMode === "voice" && (
          <label className="check" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              I consent to TreTechPro.ai recording my voice answers and transcribing them for evaluation. Recordings are stored with this
              interview, are visible only to me, and are deleted when I delete the interview. Only the text transcript is evaluated; voice,
              accent and speaking speed are never scored.
            </span>
          </label>
        )}
      </fieldset>

      <details className="field">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Optional settings</summary>
        <div style={{ marginTop: 14 }}>
          <label className="check">
            <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} />
            <span>Set a time limit</span>
          </label>
          {timed && (
            <div className="row" style={{ marginTop: 8 }}>
              <input type="number" min={5} max={240} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} style={{ width: 110 }} aria-label="Minutes" />
              <span className="muted small">minutes. Optional follow-up questions are dropped first when time runs short.</span>
            </div>
          )}
          <div className="field">
            <label htmlFor="jd">Target job description</label>
            <textarea id="jd" value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste a job posting to tailor the feedback (questions stay the same)." style={{ minHeight: 110 }} maxLength={8000} />
          </div>
        </div>
      </details>

      {error && (
        <p className="alert error" role="alert" style={{ marginTop: 16 }}>
          {error}
        </p>
      )}
      <div className="row" style={{ marginTop: 20 }}>
        <button className="btn" type="submit" disabled={!ready || busy}>
          {busy ? "Starting…" : "Start interview"}
        </button>
        {responseMode === "voice" && !consent && <span className="muted small">Consent is required for voice answers.</span>}
      </div>
    </form>
  );
}
