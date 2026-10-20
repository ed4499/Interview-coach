/**
 * Downloadable evaluation reports (report_spec formats: json, printable_html, and PDF
 * via the browser's "Save as PDF" on the printable HTML).
 */
import { CATEGORY_LABELS, type Category, LEVEL_LABELS, getConfig } from "./config";
import type { SessionDetail } from "./interview";
import type { SessionPoint } from "./progress";
import { escapeHtml as e, outlineToHtml } from "./markdown";

export function reportJson(d: SessionDetail) {
  const cfg = getConfig();
  return {
    product: cfg.product,
    version: cfg.version,
    generated_at: new Date().toISOString(),
    session: {
      session_id: d.session.id,
      role: d.session.role,
      experience_level: d.session.experience_level,
      interview_mode: d.session.interview_mode,
      response_mode: d.session.response_mode,
      time_limit_minutes: d.session.time_limit_minutes,
      started_at: d.session.started_at,
      completed_at: d.session.completed_at,
      rubric_version: d.session.rubric_version,
      consent_to_audio_recording: !!d.session.consent_to_audio_recording,
      status: d.session.status,
    },
    overall: d.original,
    overall_with_retries: d.latest,
    category_dimension_averages: d.category_dimension_averages,
    coaching: d.coaching,
    questions: d.questions.map((q) => ({
      question_id: q.question_id,
      category: q.category,
      competency: q.competency,
      question_text: q.question_text,
      attempts: q.attempts.map((a) => ({
        attempt_number: a.attempt_number,
        kind: a.kind,
        status: a.status,
        response_text: a.response_text,
        response_source: a.response_source,
        followup_text: a.followup_text,
        followup_response_text: a.followup_response_text,
        submitted_at: a.submitted_at,
        evaluation: a.evaluation,
        comparison: a.comparison,
      })),
    })),
    notes: "Scores are coaching indicators, not predictions or guarantees of hiring.",
  };
}

const meter = (score: number) =>
  `<span class="meter" role="img" aria-label="${score} out of 100"><span style="width:${Math.max(0, Math.min(100, score))}%"></span></span>`;

function categoryTable(d: SessionDetail, cat: Category): string {
  const dims = d.category_dimension_averages[cat];
  if (!dims.length) return "";
  const avg =
    cat === "behavioral" ? d.original?.behavioral_average : cat === "technical_knowledge" ? d.original?.technical_knowledge_average : d.original?.technical_scenario_average;
  return `<section><h2>${e(CATEGORY_LABELS[cat])} breakdown <span class="muted">· average ${avg ?? "–"}</span></h2>
  <table><thead><tr><th>Dimension</th><th>Weight</th><th>Average</th><th></th></tr></thead><tbody>
  ${dims.map((x) => `<tr><td>${e(x.label)}</td><td>${x.weight}%</td><td class="num">${x.average}</td><td>${meter(x.average)}</td></tr>`).join("")}
  </tbody></table></section>`;
}

function historySection(d: SessionDetail, history: SessionPoint[]): string {
  const rows = history.filter((h) => h.overall_score !== null).sort((a, b) => a.started_at.localeCompare(b.started_at));
  const retries = d.questions.flatMap((q) => q.attempts.filter((a) => a.comparison).map((a) => ({ q, a })));
  return `<section><h2>Retry comparison and session history</h2>
  ${
    retries.length
      ? `<table><thead><tr><th>Question</th><th>Attempt</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>${retries
          .map(
            ({ q, a }) =>
              `<tr><td>Q${q.position} ${e(q.question_id)}</td><td>#${a.attempt_number}</td><td class="num">${a.comparison!.score_before}</td><td class="num">${a.comparison!.score_after}</td><td class="num">${a.comparison!.score_after - a.comparison!.score_before >= 0 ? "+" : ""}${a.comparison!.score_after - a.comparison!.score_before}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : "<p class=muted>No retries yet.</p>"
  }
  <h3>${e(d.session.role)} · ${e(LEVEL_LABELS[d.session.experience_level])} sessions</h3>
  <table><thead><tr><th>Date</th><th>Interview type</th><th>Overall</th><th>Readiness</th><th>Rubric</th></tr></thead><tbody>${rows
    .map(
      (h) =>
        `<tr${h.session_id === d.session.id ? ' style="font-weight:600"' : ""}><td>${e(new Date(h.started_at).toLocaleDateString("en-US"))}</td><td>${e(h.mode_label)}</td><td class="num">${h.overall_score}</td><td>${e(h.readiness_band ?? "")}</td><td>v${e(h.rubric_version)}${h.rubric_version !== d.session.rubric_version ? " (non-equivalent)" : ""}</td></tr>`,
    )
    .join("")}</tbody></table></section>`;
}

export function reportHtml(d: SessionDetail, history: SessionPoint[] = []): string {
  const cfg = getConfig();
  const s = d.session;
  const o = d.original;
  const date = new Date(s.started_at).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });
  const questions = d.questions
    .map((q) => {
      const attempts = q.attempts
        .map((a) => {
          const ev = a.evaluation;
          const label = a.kind === "interview" ? "Original answer" : `Retry #${a.attempt_number - 1}`;
          const response =
            a.status === "skipped" ? "<em>Skipped</em>" : a.status === "not_reached" ? "<em>Not reached</em>" : e(a.response_text).replace(/\n/g, "<br>");
          const follow = a.followup_text
            ? `<p class="follow"><strong>Follow-up:</strong> ${e(a.followup_text)}<br><strong>Answer:</strong> ${e(a.followup_response_text || "—")}</p>`
            : "";
          const evalHtml = ev
            ? `<table class="dims"><thead><tr><th>Dimension</th><th>Score</th><th>Evidence</th><th>Gap / tip</th></tr></thead><tbody>
              ${ev.dimensions
                .map(
                  (x) =>
                    `<tr><td>${e(x.label)} <span class="muted">${x.weight}%</span></td><td class="num">${x.score}</td><td>${e(x.evidence)}</td><td>${x.gap ? e(x.gap) + "<br>" : ""}<span class="muted">${e(x.actionable_tip)}</span></td></tr>`,
                )
                .join("")}</tbody></table>
              <div class="cols"><div><h4>Strengths</h4><ul>${ev.strengths.map((x) => `<li>${e(x)}</li>`).join("") || "<li class=muted>None identified</li>"}</ul></div>
              <div><h4>Gaps &amp; improvements</h4><ul>${[...ev.missing_components, ...ev.improvements].map((x) => `<li>${e(x)}</li>`).join("")}</ul></div></div>
              <h4>Suggested answer outline</h4><div class="outline">${outlineToHtml(ev.answer_outline)}</div>
              <p class="muted small">Confidence: ${ev.confidence} · evaluator: ${e(ev.evaluator)}</p>`
            : "<p class=muted>Not evaluated yet.</p>";
          const cmp = a.comparison
            ? `<div class="cmp"><h4>Change vs attempt ${a.comparison.previous_attempt_number}: ${a.comparison.score_before} → ${a.comparison.score_after} (${a.comparison.score_after - a.comparison.score_before >= 0 ? "+" : ""}${a.comparison.score_after - a.comparison.score_before})</h4>
              <p>${e(a.comparison.summary)}</p>
              <p class="small">${a.comparison.deltas.map((x) => `${e(x.label)} ${x.before}→${x.after}`).join(" · ")}</p>
              <ul>${a.comparison.specific_changes.map((x) => `<li>${e(x)}</li>`).join("")}</ul></div>`
            : "";
          return `<div class="attempt"><h3>${label}${ev ? ` — <span class="score">${ev.weighted_score}</span>/100` : ""}</h3><blockquote>${response}</blockquote>${follow}${cmp}${evalHtml}</div>`;
        })
        .join("");
      return `<section class="question"><h2>Q${q.position}. <span class="muted">${e(q.question_id)} · ${e(CATEGORY_LABELS[q.category])} · ${e(q.competency)}</span></h2>
      <p class="qtext">${e(q.question_text)}</p>${attempts}</section>`;
    })
    .join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Interview Report — ${e(s.role)}</title>
<style>
:root{--ink:#0b0b0b;--muted:#52514e;--line:#dedcd6;--accent:#2a78d6;--track:#cde2fb;--bg:#fff;--soft:#f5f4f1}
body{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--bg);max-width:960px;margin:0 auto;padding:24px 16px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}h3{font-size:15px;margin:16px 0 6px}h4{font-size:13px;margin:12px 0 4px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.muted{color:var(--muted);font-weight:400}.small{font-size:12px}.num{font-variant-numeric:tabular-nums;text-align:right}
table{width:100%;border-collapse:collapse;margin:6px 0}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}th{font-size:12px;color:var(--muted)}
.meter{display:inline-block;width:140px;height:8px;border-radius:4px;background:var(--track);overflow:hidden;vertical-align:middle}.meter span{display:block;height:100%;background:var(--accent);border-radius:4px}
.hero{display:flex;gap:32px;align-items:baseline;flex-wrap:wrap;padding:16px;background:var(--soft);border-radius:8px}.hero .big{font-size:52px;font-weight:600;line-height:1}
blockquote{margin:6px 0;padding:8px 12px;border-left:3px solid var(--line);background:var(--soft);white-space:normal}
.attempt{border-top:1px dashed var(--line);margin-top:10px}.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}.outline{background:var(--soft);padding:4px 12px;border-radius:6px}
.placeholder{background:#fff3c4;padding:0 2px;border-radius:3px}.cmp{background:#eef5fd;padding:4px 12px;border-radius:6px}.score{color:var(--accent)}
.qtext{font-weight:500}.toolbar{margin-bottom:16px}.toolbar button{font:inherit;padding:6px 14px;border-radius:6px;border:1px solid var(--line);background:var(--bg);cursor:pointer}
.question{break-inside:avoid-page}
@media (max-width:640px){.cols{grid-template-columns:1fr}.meter{width:80px}}
@media print{.toolbar{display:none}body{padding:0}a{color:inherit}}
</style></head><body>
<div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>
<h1>${e(cfg.product)} ${e(cfg.version)} — Interview Report</h1>
<p class="muted">${e(s.role)} · ${e(LEVEL_LABELS[s.experience_level])} · ${e(s.mode_label)} · ${e(date)}<br>
Responses: ${s.response_mode === "voice" ? "voice (transcribed)" : "text"}${s.time_limit_minutes ? ` · time limit ${s.time_limit_minutes} min` : ""} · rubric v${e(s.rubric_version)} · session ${e(s.id)}</p>

<section><h2>Overall score and readiness</h2>
${
  o
    ? `<div class="hero"><div><div class="big">${o.overall_score}</div><div class="muted">overall / 100</div></div><div><strong>${e(o.readiness_band)}</strong><br><span class="muted">Behavioral ${o.behavioral_average ?? "–"} · Technical knowledge ${o.technical_knowledge_average ?? "–"} · Scenario ${o.technical_scenario_average ?? "–"}</span>
    ${d.latest && d.latest.overall_score !== o.overall_score ? `<br>With retries: <strong>${d.latest.overall_score}</strong>` : ""}</div></div>
    <p class="muted small">${e(o.notes)} Readiness bands: 0–49 foundation building · 50–69 developing · 70–84 proficient · 85–100 strong practice performance.</p>`
    : `<p>Evaluation not available (${e(s.status)}).</p>`
}</section>
${categoryTable(d, "behavioral")}${categoryTable(d, "technical_knowledge")}${categoryTable(d, "technical_scenario")}
${
  d.coaching
    ? `<section><h2>Top three improvement priorities</h2><ol>${d.coaching.coaching_actions
        .map((a) => `<li><strong>${e(a.title)}</strong> — ${e(a.detail)}${a.related_question_ids.length ? ` <span class="muted">(${a.related_question_ids.map(e).join(", ")})</span>` : ""}</li>`)
        .join("")}</ol><p>${e(d.coaching.overall_notes)}</p></section>`
    : ""
}
<section><h2>Questions, responses and feedback</h2></section>
${questions}
${historySection(d, history)}
<p class="muted small">Generated ${e(new Date().toLocaleString("en-US"))}. ${e(cfg.report_spec.privacy)}</p>
</body></html>`;
}
