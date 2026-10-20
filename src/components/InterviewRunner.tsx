"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { InterviewState } from "@/lib/interview";
import AnswerInput, { type AnswerValue, emptyAnswer } from "./AnswerInput";

interface Props {
  initial: InterviewState;
  levelLabel: string;
  categoryLabels: Record<string, string>;
}

function useCountdown(deadline: string | null) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!deadline) return;
    const tick = () => setLeft(Math.max(0, Date.parse(deadline) - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [deadline]);
  return left;
}

export default function InterviewRunner({ initial, levelLabel, categoryLabels }: Props) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [answer, setAnswer] = useState<AnswerValue>(emptyAnswer);
  const [busy, setBusy] = useState(false);
  const [inputBusy, setInputBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const left = useCountdown(state.deadline_at);
  const onBusyChange = useCallback((b: boolean) => setInputBusy(b), []);

  const step = state.step;
  const voice = state.response_mode === "voice";
  const timeUp = step.type === "time_up" || left === 0;

  async function submit(skip = false) {
    if (step.type !== "question" && step.type !== "followup") return;
    setBusy(true);
    setError(null);
    setSavedNote(null);
    try {
      const res = await fetch(`/api/sessions/${state.session_id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question_id: step.question_id,
          phase: step.type === "question" ? "base" : "followup",
          skip,
          response_text: answer.text,
          response_source: answer.source,
          transcript_raw: answer.transcript_raw,
          audio_id: answer.audio_id,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.saved) throw new Error(data.error ?? "Your answer was not saved.");
      setState(data.state);
      setAnswer(emptyAnswer);
      setSavedNote(skip ? "Skipped." : "Answer saved.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(`${err instanceof Error ? err.message : String(err)} Your text is still in the box; please try again.`);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setFinishing(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${state.session_id}/complete`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && data.status !== "evaluation_failed") throw new Error(data.error ?? "Could not finish the interview.");
      router.push(`/interview/${state.session_id}/results`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFinishing(false);
    }
  }

  const answeredPct = Math.round((state.answered / state.total_questions) * 100);
  const mins = left !== null ? `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}` : null;

  if (finishing) {
    return (
      <div className="card center" style={{ padding: 48 }}>
        <div className="spinner" style={{ margin: "0 auto 16px" }} />
        <h2>Evaluating your interview…</h2>
        <p className="muted">Each answer is scored against its rubric. This usually takes under a minute.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1 style={{ marginBottom: 4 }}>{state.role}</h1>
          <span className="muted">
            {levelLabel} · mock interview
          </span>
        </div>
        <div className="row">
          {mins && (
            <span className={`chip ${left! < 5 * 60000 ? "" : "brand"}`} aria-live="polite">
              ⏱ {mins} left
            </span>
          )}
          <span className="chip">
            {Math.min(state.answered + (step.type === "finished" ? 0 : 1), state.total_questions)} of {state.total_questions}
          </span>
        </div>
      </div>
      <div className="progress" aria-hidden>
        <span style={{ width: `${answeredPct}%` }} />
      </div>
      {savedNote && (
        <p className="small status-good" role="status">
          ✓ {savedNote}
        </p>
      )}

      {(step.type === "question" || step.type === "followup") && !timeUp && (
        <div className="card">
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="chip brand">{categoryLabels[step.category]}</span>
            <span className="muted small">Question {step.position}</span>
          </div>
          <p className="question-text">{step.question_text}</p>

          {step.type === "followup" && (
            <>
              <details style={{ marginBottom: 12 }}>
                <summary className="muted small" style={{ cursor: "pointer" }}>
                  Your answer (saved)
                </summary>
                <blockquote className="response">{step.response_text}</blockquote>
              </details>
              <div className="followup" style={{ marginBottom: 14 }}>
                <strong>Follow-up:</strong> {step.followup_text}
              </div>
            </>
          )}

          <AnswerInput
            key={`${step.question_id}-${step.type}`}
            sessionId={state.session_id}
            voice={voice}
            value={answer}
            onChange={setAnswer}
            onBusyChange={onBusyChange}
            disabled={busy}
            label={step.type === "followup" ? "Your follow-up answer" : "Your answer"}
          />
          {step.category === "behavioral" && step.type === "question" && (
            <p className="hint">Tip: describe the Situation, your Task, the Actions you personally took, and the Result.</p>
          )}
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          <div className="spread" style={{ marginTop: 14 }}>
            <div className="row">
              <button className="btn" onClick={() => submit(false)} disabled={busy || inputBusy || !answer.text.trim()}>
                {busy ? "Saving…" : step.type === "followup" ? "Submit follow-up" : "Submit answer"}
              </button>
              <button className="btn ghost" onClick={() => submit(true)} disabled={busy || inputBusy}>
                {step.type === "followup" ? "Skip follow-up" : "Skip question"}
              </button>
            </div>
            <button
              className="btn ghost small"
              onClick={() => confirm("End the interview now? Unanswered questions will score 0.") && finish()}
              disabled={busy || inputBusy}
            >
              End interview early
            </button>
          </div>
        </div>
      )}

      {(step.type === "finished" || timeUp) && (
        <div className="card center" style={{ padding: 40 }}>
          <h2>{timeUp && step.type !== "finished" ? "Time is up" : "That's the end of the interview"}</h2>
          <p className="muted">
            {state.answered} of {state.total_questions} questions answered. Your responses are saved. Get your scores, coaching and suggested
            answer outlines.
          </p>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          <button className="btn" onClick={finish}>
            Finish &amp; get feedback
          </button>
        </div>
      )}
    </div>
  );
}
