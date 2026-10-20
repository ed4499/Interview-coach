"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Polls while evaluation runs, and lets the candidate re-run a failed evaluation. */
export default function EvaluationStatus({ sessionId, status, error }: { sessionId: string; status: string; error: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status !== "evaluating") return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/sessions/${sessionId}`);
      const data = await res.json().catch(() => null);
      if (data?.state?.status && data.state.status !== "evaluating") router.refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [status, sessionId, router]);

  async function rerun() {
    setBusy(true);
    await fetch(`/api/sessions/${sessionId}/complete`, { method: "POST" }).catch(() => null);
    setBusy(false);
    router.refresh();
  }

  if (status === "evaluating") {
    return (
      <div className="card center" style={{ padding: 40 }}>
        <div className="spinner" style={{ margin: "0 auto 16px" }} />
        <h2>Evaluating your interview…</h2>
        <p className="muted">This page updates automatically.</p>
      </div>
    );
  }
  return (
    <div className="card">
      <h2>Evaluation incomplete</h2>
      <p>Your answers are saved, but the evaluation could not be completed.</p>
      {error && <p className="alert error small">{error}</p>}
      <button className="btn" onClick={rerun} disabled={busy}>
        {busy ? "Evaluating…" : "Try evaluation again"}
      </button>
    </div>
  );
}
