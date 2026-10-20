"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import AnswerInput, { type AnswerValue, emptyAnswer } from "./AnswerInput";

export default function RetryForm({
  sessionId,
  questionId,
  voice,
  pendingAttemptId,
}: {
  sessionId: string;
  questionId: string;
  voice: boolean;
  pendingAttemptId: string | null;
}) {
  const router = useRouter();
  const [answer, setAnswer] = useState<AnswerValue>(emptyAnswer);
  const [busy, setBusy] = useState(false);
  const [inputBusy, setInputBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onBusyChange = useCallback((b: boolean) => setInputBusy(b), []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question_id: questionId,
          response_text: answer.text,
          response_source: answer.source,
          transcript_raw: answer.transcript_raw,
          audio_id: answer.audio_id,
        }),
      });
      const data = await res.json();
      if (!data.saved) throw new Error(data.error ?? "Your retry was not saved.");
      setAnswer(emptyAnswer);
      if (!data.evaluated) setError(`Your answer was saved, but scoring failed: ${data.error ?? "unknown error"}. Use “Score my saved retry”.`);
      router.refresh();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(`${err instanceof Error ? err.message : String(err)} Your text is still in the box.`);
    } finally {
      setBusy(false);
    }
  }

  async function rescore() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/sessions/${sessionId}/attempts/${pendingAttemptId}/evaluate`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Scoring failed again. Please try later.");
    setBusy(false);
    router.refresh();
  }

  if (busy && !error) {
    return (
      <div className="center" style={{ padding: 24 }}>
        <div className="spinner" style={{ margin: "0 auto 12px" }} />
        <p className="muted">Scoring your new attempt with the same rubric…</p>
      </div>
    );
  }

  if (pendingAttemptId) {
    return (
      <div>
        <p className="alert">Your last retry is saved but has not been scored yet.</p>
        {error && <p className="alert error">{error}</p>}
        <button className="btn" onClick={rescore} disabled={busy}>
          Score my saved retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <AnswerInput sessionId={sessionId} voice={voice} value={answer} onChange={setAnswer} onBusyChange={onBusyChange} disabled={busy} label="Revised answer" />
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <button className="btn" style={{ marginTop: 12 }} onClick={submit} disabled={busy || inputBusy || !answer.text.trim()}>
        Submit and compare
      </button>
    </div>
  );
}
