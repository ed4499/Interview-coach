import Link from "next/link";
import { getCandidateId } from "@/lib/candidate";
import { LEVEL_LABELS, dimensionLabel } from "@/lib/config";
import { getProgress } from "@/lib/progress";
import DeleteSessionButton from "@/components/DeleteSessionButton";
import TrendChart from "@/components/TrendChart";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  in_progress: "In progress",
  evaluating: "Evaluating",
  completed: "Completed",
  evaluation_failed: "Needs re-evaluation",
};

export default async function Dashboard() {
  const candidate = await getCandidateId();
  const p = candidate ? getProgress(candidate) : null;

  if (!p || p.interview_count === 0) {
    return (
      <div className="card empty">
        <h1>Practice interviews that coach you to a stronger answer</h1>
        <p className="muted" style={{ maxWidth: 620, margin: "0 auto 20px" }}>
          Choose one of 17 IT, security, AI and data roles. Answer 15 role-specific questions (5 behavioral, 5 technical knowledge, 5 technical
          scenarios) by voice or text, then get STAR and technical scoring, coaching, and the chance to retry any question.
        </p>
        <Link href="/interview/new" className="btn">
          Start your first mock interview
        </Link>
      </div>
    );
  }

  const latest = p.sessions.find((s) => s.overall_score !== null);
  const starSessions = p.sessions.filter((s) => s.star).slice(0, 6);
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="stack">
      <div className="spread">
        <h1 style={{ margin: 0 }}>Your interview dashboard</h1>
        <Link href="/interview/new" className="btn">
          New mock interview
        </Link>
      </div>

      <div className="grid grid-4">
        <div className="card">
          <div className="stat-label">Latest overall score</div>
          <div className="hero-number">{latest?.overall_score ?? "–"}</div>
          <div className="small muted">{latest ? `${latest.readiness_band} · ${latest.role}` : "Finish an interview to see scores"}</div>
        </div>
        <div className="card">
          <div className="stat-label">Interviews</div>
          <div className="stat-value">{p.interview_count}</div>
          <div className="small muted">{p.completed_count} evaluated</div>
        </div>
        <div className="card">
          <div className="stat-label">Retries</div>
          <div className="stat-value">{p.retry_improvement.retries}</div>
          <div className="small muted">
            {p.retry_improvement.average_delta !== null
              ? `Average change ${p.retry_improvement.average_delta >= 0 ? "+" : ""}${p.retry_improvement.average_delta} points`
              : "Retry a question to measure improvement"}
          </div>
        </div>
        <div className="card">
          <div className="stat-label">Roles practiced</div>
          <div className="stat-value">{new Set(p.role_and_level_history.map((h) => h.role)).size}</div>
          <div className="small muted">{p.role_and_level_history[0] ? `Most recent: ${p.role_and_level_history[0].role}` : ""}</div>
        </div>
      </div>

      {p.groups.length > 0 && (
        <div className="card">
          <h2>Overall score by session</h2>
          <p className="muted small">Only sessions with the same role, level and rubric version are compared.</p>
          <TrendChart groups={p.groups} />
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <h2>Practice recommendations</h2>
          {p.recommendations.length ? (
            p.recommendations.map((r, i) => (
              <div className="rec" key={i}>
                <strong>{r.title}</strong>
                <div>{r.detail}</div>
                <div className="muted small">{r.source}</div>
              </div>
            ))
          ) : (
            <p className="muted">Complete an interview to get personalized recommendations.</p>
          )}
        </div>
        <div className="card">
          <h2>Technical skill gaps</h2>
          {p.technical_skill_gaps.length ? (
            <table>
              <thead>
                <tr>
                  <th>Dimension</th>
                  <th className="num">Average</th>
                </tr>
              </thead>
              <tbody>
                {p.technical_skill_gaps.map((g) => (
                  <tr key={g.category + g.dimension}>
                    <td>
                      {g.dimension}
                      <div className="muted small">{g.category}</div>
                    </td>
                    <td className="num">{g.average}</td>
                  </tr>
                ))}
                {p.weakest_competencies.slice(0, 2).map((c) => (
                  <tr key={c.competency}>
                    <td>
                      Competency: {c.competency}
                      <div className="muted small">
                        {c.samples} {c.samples === 1 ? "answer" : "answers"}
                      </div>
                    </td>
                    <td className="num">{c.average}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Answer technical questions to see your gaps.</p>
          )}
        </div>
      </div>

      {starSessions.length > 0 && (
        <div className="card">
          <h2>STAR dimension trends</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Session</th>
                  {["situation", "task", "action", "result"].map((k) => (
                    <th key={k} className="num">
                      {dimensionLabel(k)}
                    </th>
                  ))}
                  <th className="num">Behavioral avg</th>
                </tr>
              </thead>
              <tbody>
                {starSessions.map((s) => (
                  <tr key={s.session_id}>
                    <td>
                      {fmtDate(s.started_at)}
                      <div className="muted small">
                        {s.role} · {LEVEL_LABELS[s.experience_level as keyof typeof LEVEL_LABELS]}
                      </div>
                    </td>
                    {["situation", "task", "action", "result"].map((k) => (
                      <td key={k} className="num">
                        {s.star?.[k] ?? "–"}
                      </td>
                    ))}
                    <td className="num">{s.behavioral_average ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Interview history</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Role &amp; level</th>
                <th>Type</th>
                <th>Status</th>
                <th className="num">Score</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {p.sessions.map((s) => (
                <tr key={s.session_id}>
                  <td>{fmtDate(s.started_at)}</td>
                  <td>
                    {s.role}
                    <div className="muted small">{LEVEL_LABELS[s.experience_level as keyof typeof LEVEL_LABELS]}</div>
                  </td>
                  <td className="small">{s.mode_label}</td>
                  <td className="small">{STATUS[s.status]}</td>
                  <td className="num">
                    {s.overall_score ?? "–"}
                    {s.latest_score !== null && s.latest_score !== s.overall_score && <div className="muted small">retries: {s.latest_score}</div>}
                  </td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
                      {s.status === "in_progress" ? (
                        <Link className="btn secondary small" href={`/interview/${s.session_id}`}>
                          Continue
                        </Link>
                      ) : (
                        <Link className="btn secondary small" href={`/interview/${s.session_id}/results`}>
                          Review
                        </Link>
                      )}
                      {s.status === "completed" && (
                        <a className="btn ghost small" href={`/api/sessions/${s.session_id}/report?format=html`} target="_blank" rel="noopener">
                          Report
                        </a>
                      )}
                      <DeleteSessionButton sessionId={s.session_id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
