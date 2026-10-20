import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCandidateId } from "@/lib/candidate";
import { CATEGORY_LABELS } from "@/lib/config";
import { getSession, getSessionDetail } from "@/lib/interview";
import { ComparisonPanel, EvaluationPanel, ResponseBlock } from "@/components/Evaluation";
import RetryForm from "@/components/RetryForm";

export const dynamic = "force-dynamic";

export default async function RetryPage({ params }: { params: Promise<{ id: string; questionId: string }> }) {
  const { id, questionId } = await params;
  const candidate = await getCandidateId();
  const s = candidate ? getSession(id, candidate) : null;
  if (!s) notFound();
  if (s.status !== "completed") redirect(`/interview/${id}/results`);
  const q = getSessionDetail(s).questions.find((x) => x.question_id === questionId);
  if (!q) notFound();
  const original = q.attempts[0];
  const latest = q.attempts[q.attempts.length - 1];
  const pendingRetry = latest.kind === "retry" && !latest.evaluation ? latest : null;
  const lastEvaluated = [...q.attempts].reverse().find((a) => a.evaluation)!;

  return (
    <div className="stack">
      <div>
        <Link href={`/interview/${id}/results`} className="small">
          ← Back to results
        </Link>
        <h1 style={{ marginTop: 8 }}>Retry question {q.position}</h1>
        <span className="chip brand">{CATEGORY_LABELS[q.category]}</span> <span className="muted small">{q.competency}</span>
      </div>

      <div className="card">
        <p className="question-text">{q.question_text}</p>
      </div>

      {latest.comparison && latest.kind === "retry" && <ComparisonPanel a={latest} />}

      <div className="card">
        <h2>
          {lastEvaluated === original ? "Your original answer" : `Your latest answer (attempt ${lastEvaluated.attempt_number})`} ·{" "}
          {lastEvaluated.evaluation!.weighted_score}/100
        </h2>
        <ResponseBlock a={lastEvaluated} />
        <div style={{ marginTop: 12 }}>
          <EvaluationPanel ev={lastEvaluated.evaluation!} />
        </div>
      </div>

      <div className="card">
        <h2>Your new attempt</h2>
        <p className="muted">
          Answer again using the feedback and outline above. Use only your real experience. Replace each [placeholder] with what actually
          happened. Your earlier answers are kept and never overwritten.
        </p>
        <RetryForm sessionId={id} questionId={questionId} voice={s.response_mode === "voice" && !!s.consent_to_audio_recording} pendingAttemptId={pendingRetry?.id ?? null} />
      </div>

      {q.attempts.length > 2 && (
        <div className="card">
          <h2>All attempts</h2>
          <table>
            <thead>
              <tr>
                <th>Attempt</th>
                <th>Submitted</th>
                <th className="num">Score</th>
              </tr>
            </thead>
            <tbody>
              {q.attempts.map((a) => (
                <tr key={a.id}>
                  <td>{a.kind === "interview" ? "Original" : `Retry #${a.attempt_number - 1}`}</td>
                  <td>{a.submitted_at ? new Date(a.submitted_at).toLocaleString("en-US") : "–"}</td>
                  <td className="num">{a.evaluation?.weighted_score ?? "pending"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
