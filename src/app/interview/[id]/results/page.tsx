import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCandidateId } from "@/lib/candidate";
import { CATEGORY_LABELS, type Category, LEVEL_LABELS } from "@/lib/config";
import { getSession, getSessionDetail } from "@/lib/interview";
import { ComparisonPanel, EvaluationPanel, Meter, ResponseBlock } from "@/components/Evaluation";
import EvaluationStatus from "@/components/EvaluationStatus";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const candidate = await getCandidateId();
  const s = candidate ? getSession(id, candidate) : null;
  if (!s) notFound();
  if (s.status === "in_progress") redirect(`/interview/${id}`);
  const d = getSessionDetail(s);
  const date = new Date(s.started_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  const header = (
    <div className="spread">
      <div>
        <h1 style={{ marginBottom: 4 }}>{s.role} interview results</h1>
        <span className="muted">
          {LEVEL_LABELS[s.experience_level]} · {d.session.mode_label} · {date}
        </span>
      </div>
      {s.status === "completed" && (
        <div className="row">
          <a className="btn secondary small" href={`/api/sessions/${id}/report`} download>
            Download PDF report
          </a>
        </div>
      )}
    </div>
  );

  if (s.status !== "completed" || !d.original) {
    return (
      <div className="stack">
        {header}
        <EvaluationStatus sessionId={id} status={s.status} error={s.evaluation_error} />
      </div>
    );
  }

  const o = d.original;
  const cats = (["behavioral", "technical_knowledge", "technical_scenario"] as Category[]).filter((c) => d.category_dimension_averages[c].length);
  const catAvg = { behavioral: o.behavioral_average, technical_knowledge: o.technical_knowledge_average, technical_scenario: o.technical_scenario_average };

  return (
    <div className="stack">
      {header}

      <div className="card">
        <div className="row" style={{ gap: 32, alignItems: "flex-end" }}>
          <div>
            <div className="hero-number">{o.overall_score}</div>
            <div className="stat-label">Overall score / 100</div>
          </div>
          <div>
            <div className="stat-value">{o.readiness_band}</div>
            <div className="stat-label">Readiness band</div>
          </div>
          {d.latest && d.latest.overall_score !== o.overall_score && (
            <div>
              <div className="stat-value">{d.latest.overall_score}</div>
              <div className="stat-label">With your retries</div>
            </div>
          )}
        </div>
        <p className="muted small" style={{ marginTop: 12, marginBottom: 0 }}>
          {o.notes}
        </p>
      </div>

      <div className={`grid grid-${cats.length}`}>
        {cats.map((c) => (
          <div className="card" key={c}>
            <div className="spread">
              <h3 style={{ margin: 0 }}>{CATEGORY_LABELS[c]}</h3>
              <span className="score-pill">{catAvg[c]}</span>
            </div>
            <table style={{ marginTop: 8 }}>
              <tbody>
                {d.category_dimension_averages[c].map((x) => (
                  <tr key={x.key}>
                    <td>
                      {x.label} <span className="muted small">{x.weight}%</span>
                    </td>
                    <td style={{ width: "40%" }}>
                      <Meter score={x.average} label={x.label} />
                    </td>
                    <td className="num">{x.average}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {d.coaching && (
        <div className="card">
          <h2>Your top three coaching priorities</h2>
          <ol style={{ paddingLeft: 20 }}>
            {d.coaching.coaching_actions.map((a) => (
              <li key={a.priority} style={{ marginBottom: 10 }}>
                <strong>{a.title}</strong>
                <div>{a.detail}</div>
                {a.related_question_ids.length > 0 && <div className="muted small">Related: {a.related_question_ids.join(", ")}</div>}
              </li>
            ))}
          </ol>
          <p className="muted">{d.coaching.overall_notes}</p>
          <p className="small" style={{ marginBottom: 0 }}>
            Ready to improve? Open any question below and choose <strong>Retry this question</strong>.
          </p>
        </div>
      )}

      <div>
        <h2>Question-by-question feedback</h2>
        {d.questions.map((q) => {
          const first = q.attempts.find((a) => a.attempt_number === 1)!;
          const latest = q.attempts[q.attempts.length - 1];
          return (
            <details className="q" key={q.question_id}>
              <summary>
                <span>
                  <span className="muted small">
                    Q{q.position} · {CATEGORY_LABELS[q.category]} · {q.competency}
                  </span>
                  <br />
                  {q.question_text}
                </span>
                <span className="row" style={{ flexShrink: 0 }}>
                  {latest !== first && latest.evaluation && <span className="chip">retry {latest.evaluation.weighted_score}</span>}
                  <span className="score-pill">{first.evaluation?.weighted_score ?? "–"}</span>
                </span>
              </summary>
              <div className="body stack">
                {q.attempts.map((a) => (
                  <div key={a.id} className="stack">
                    <h3 style={{ marginTop: 8 }}>
                      {a.kind === "interview" ? "Your original answer" : `Retry #${a.attempt_number - 1}`}
                      {a.evaluation && <span className="muted"> · {a.evaluation.weighted_score}/100</span>}
                    </h3>
                    <ResponseBlock a={a} />
                    <ComparisonPanel a={a} />
                    {a.evaluation ? <EvaluationPanel ev={a.evaluation} /> : <p className="muted">Evaluation pending.</p>}
                  </div>
                ))}
                <div>
                  <Link className="btn" href={`/interview/${id}/retry/${q.question_id}`}>
                    Retry this question
                  </Link>
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
