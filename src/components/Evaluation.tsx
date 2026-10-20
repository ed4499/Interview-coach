import type { AttemptView, EvaluationView } from "@/lib/interview";
import { outlineToHtml } from "@/lib/markdown";

export function Meter({ score, label }: { score: number; label?: string }) {
  return (
    <span className="meter" role="img" aria-label={`${label ? label + ": " : ""}${score} out of 100`}>
      <span style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
    </span>
  );
}

export function Outline({ markdown }: { markdown: string }) {
  // outlineToHtml escapes all text before adding markup.
  return <div className="outline" dangerouslySetInnerHTML={{ __html: outlineToHtml(markdown) }} />;
}

export function EvaluationPanel({ ev }: { ev: EvaluationView }) {
  return (
    <div className="stack">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Dimension</th>
              <th className="num">Score</th>
              <th>Evidence from your answer</th>
              <th>Gap &amp; tip</th>
            </tr>
          </thead>
          <tbody>
            {ev.dimensions.map((d) => (
              <tr key={d.key}>
                <td style={{ minWidth: 150 }}>
                  <strong>{d.label}</strong> <span className="muted small">{d.weight}%</span>
                  <div>
                    <Meter score={d.score} label={d.label} />
                  </div>
                </td>
                <td className="num">{d.score}</td>
                <td>{d.evidence}</td>
                <td>
                  {d.gap && <div>{d.gap}</div>}
                  <div className="muted small">{d.actionable_tip}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-2">
        <div>
          <h3>Strengths</h3>
          {ev.strengths.length ? (
            <ul>{ev.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
          ) : (
            <p className="muted">No clear strengths identified yet.</p>
          )}
        </div>
        <div>
          <h3>{ev.category === "behavioral" ? "Missing STAR components & improvements" : "Knowledge gaps & improvements"}</h3>
          {ev.missing_components.length + ev.improvements.length ? (
            <ul>
              {ev.missing_components.map((s, i) => (
                <li key={`m${i}`}>{s}</li>
              ))}
              {ev.improvements.map((s, i) => (
                <li key={`i${i}`}>{s}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">No significant gaps identified.</p>
          )}
        </div>
      </div>
      <div>
        <h3>How to structure a stronger answer</h3>
        <p className="muted small">Built only from what you said. Highlighted [placeholders] are details to fill in from your real experience.</p>
        <Outline markdown={ev.answer_outline} />
      </div>
      <p className="muted small">
        Weighted score {ev.weighted_score}/100 · confidence {ev.confidence}
      </p>
    </div>
  );
}

export function ResponseBlock({ a }: { a: AttemptView }) {
  if (a.status === "skipped") return <p className="muted">Skipped.</p>;
  if (a.status === "not_reached") return <p className="muted">Not reached before the interview ended.</p>;
  return (
    <>
      <blockquote className="response">{a.response_text}</blockquote>
      {a.audio_uri && <audio controls preload="none" src={a.audio_uri} style={{ width: "100%", maxWidth: 420 }} />}
      {a.followup_text && (
        <div className="followup" style={{ marginTop: 8 }}>
          <strong>Follow-up:</strong> {a.followup_text}
          <div style={{ marginTop: 4 }}>{a.followup_response_text || <span className="muted">No follow-up answer.</span>}</div>
        </div>
      )}
    </>
  );
}

export function ComparisonPanel({ a }: { a: AttemptView }) {
  const c = a.comparison;
  if (!c) return null;
  const delta = c.score_after - c.score_before;
  return (
    <div className="card" style={{ background: "var(--brand-soft)" }}>
      <div className="spread">
        <h3 style={{ margin: 0 }}>
          Attempt {c.previous_attempt_number} → attempt {a.attempt_number}
        </h3>
        <span className="score-pill">
          {c.score_before} → {c.score_after} ({delta >= 0 ? "+" : ""}
          {delta})
        </span>
      </div>
      <p style={{ marginTop: 10 }}>{c.summary}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Dimension</th>
              <th className="num">Before</th>
              <th className="num">After</th>
              <th className="num">Change</th>
            </tr>
          </thead>
          <tbody>
            {c.deltas.map((d) => (
              <tr key={d.key}>
                <td>{d.label}</td>
                <td className="num">{d.before}</td>
                <td className="num">{d.after}</td>
                <td className={`num ${d.delta > 0 ? "status-good" : d.delta < 0 ? "status-bad" : ""}`}>
                  {d.delta > 0 ? "▲ +" : d.delta < 0 ? "▼ " : ""}
                  {d.delta}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {c.specific_changes.length > 0 && (
        <>
          <h3>What you changed</h3>
          <ul>{c.specific_changes.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}
      {c.remaining_gaps.length > 0 && (
        <>
          <h3>Still to work on</h3>
          <ul>{c.remaining_gaps.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}
    </div>
  );
}
