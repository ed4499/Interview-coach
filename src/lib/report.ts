/**
 * The candidate's downloadable evaluation report: a PDF generated on the server
 * (PDF is the only download format offered to candidates).
 */
import PDFDocument from "pdfkit";
import { CATEGORY_LABELS, type Category, LEVEL_LABELS, getConfig } from "./config";
import type { AttemptView, EvaluationView, SessionDetail } from "./interview";
import type { SessionPoint } from "./progress";

const INK = "#111111";
const MUTED = "#5f5e5a";
const ACCENT = "#2a78d6";
const TRACK = "#cde2fb";
const RULE = "#dedcd6";
const MARGIN = 54;

// The built-in PDF fonts only cover the Windows-1252 character set.
const WIN_ANSI_EXTRA = new Set("ŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™");
function clean(text: string): string {
  return text
    .replace(/[→⇒]/g, "->")
    .replace(/[←]/g, "<-")
    .replace(/[≥]/g, ">=")
    .replace(/[≤]/g, "<=")
    .replace(/[   ]/g, " ")
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, (c) => (WIN_ANSI_EXTRA.has(c) ? c : ""));
}

type Doc = InstanceType<typeof PDFDocument>;

class Writer {
  constructor(private doc: Doc) {}

  private get width() {
    return this.doc.page.width - MARGIN * 2;
  }

  /** Starts a new page if fewer than `points` remain. */
  ensure(points: number) {
    if (this.doc.y + points > this.doc.page.height - MARGIN) this.doc.addPage();
  }

  gap(points = 8) {
    this.doc.y += points;
  }

  heading(text: string, size = 15) {
    this.ensure(size * 3);
    this.gap(size * 0.6);
    this.doc.font("Helvetica-Bold").fontSize(size).fillColor(INK).text(clean(text), MARGIN, this.doc.y, { width: this.width });
    this.gap(4);
  }

  text(text: string, opts: { size?: number; color?: string; bold?: boolean; indent?: number; italic?: boolean } = {}) {
    const font = opts.bold ? "Helvetica-Bold" : opts.italic ? "Helvetica-Oblique" : "Helvetica";
    this.doc
      .font(font)
      .fontSize(opts.size ?? 10)
      .fillColor(opts.color ?? INK)
      .text(clean(text), MARGIN + (opts.indent ?? 0), this.doc.y, { width: this.width - (opts.indent ?? 0), lineGap: 2 });
  }

  muted(text: string, size = 9) {
    this.text(text, { size, color: MUTED });
  }

  label(label: string, value: string) {
    this.doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(clean(`${label}: `), MARGIN, this.doc.y, { continued: true, width: this.width });
    this.doc.font("Helvetica").text(clean(value), { width: this.width, lineGap: 2 });
  }

  bullets(items: string[], indent = 10) {
    for (const item of items) {
      this.ensure(14);
      this.doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(INK)
        .text(clean(`•  ${item}`), MARGIN + indent, this.doc.y, { width: this.width - indent, lineGap: 2, indent: 0 });
    }
  }

  /** A response or quote, set off with a left rule. */
  quote(text: string) {
    const x = MARGIN + 10;
    const top = this.doc.y;
    this.doc.font("Helvetica").fontSize(10).fillColor(INK);
    const height = this.doc.heightOfString(clean(text), { width: this.width - 14, lineGap: 2 });
    if (top + Math.min(height, 120) > this.doc.page.height - MARGIN) this.doc.addPage();
    const start = this.doc.y;
    this.doc.text(clean(text), x, start, { width: this.width - 14, lineGap: 2 });
    const end = this.doc.y;
    if (end > start) this.doc.save().rect(MARGIN, start, 2.5, end - start).fill(RULE).restore();
    this.doc.x = MARGIN;
  }

  /** Label, score bar and value on one line (a "meter"). */
  meter(label: string, score: number, weight?: number) {
    this.ensure(18);
    const y = this.doc.y;
    const barX = MARGIN + 190;
    const barW = 200;
    this.doc.font("Helvetica").fontSize(10).fillColor(INK).text(clean(label), MARGIN, y, { width: 150, lineBreak: false });
    if (weight !== undefined) this.doc.fillColor(MUTED).fontSize(9).text(`${weight}%`, MARGIN + 152, y + 1, { width: 34, lineBreak: false });
    this.doc.save().roundedRect(barX, y + 2, barW, 7, 3.5).fill(TRACK);
    const filled = (Math.max(0, Math.min(100, score)) / 100) * barW;
    if (filled > 0) this.doc.roundedRect(barX, y + 2, Math.max(filled, 7), 7, 3.5).fill(ACCENT);
    this.doc.restore();
    this.doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(String(score), barX + barW + 12, y, { width: 40, lineBreak: false });
    this.doc.x = MARGIN;
    this.doc.y = y + 16;
  }

  rule() {
    this.ensure(14);
    this.gap(4);
    this.doc.save().moveTo(MARGIN, this.doc.y).lineTo(this.doc.page.width - MARGIN, this.doc.y).lineWidth(0.6).strokeColor(RULE).stroke().restore();
    this.gap(8);
  }
}

/** Answer outlines are short markdown: "- **Label:** text" bullets and plain lines. */
function outlineLines(md: string): { bullet: boolean; text: string }[] {
  return md
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
      const text = (m ? m[1] : l.replace(/^#+\s*/, "")).replace(/\*\*(.+?)\*\*/g, "$1");
      return { bullet: !!m, text };
    });
}

function evaluationBlock(w: Writer, ev: EvaluationView) {
  for (const d of ev.dimensions) {
    w.ensure(50);
    w.meter(d.label, d.score, d.weight);
    w.text(`Evidence: ${d.evidence}`, { size: 9, indent: 10 });
    if (d.gap) w.text(`Gap: ${d.gap}`, { size: 9, indent: 10 });
    w.text(`Tip: ${d.actionable_tip}`, { size: 9, indent: 10, color: MUTED });
    w.gap(4);
  }
  if (ev.strengths.length) {
    w.ensure(36);
    w.text("Strengths", { bold: true });
    w.bullets(ev.strengths);
    w.gap(4);
  }
  const gaps = [...ev.missing_components, ...ev.improvements];
  if (gaps.length) {
    w.ensure(36);
    w.text(ev.category === "behavioral" ? "Missing STAR components and improvements" : "Knowledge gaps and improvements", { bold: true });
    w.bullets(gaps);
    w.gap(4);
  }
  w.ensure(50);
  w.text("How to structure a stronger answer", { bold: true });
  w.muted("Built only from what you said. [Bracketed] items are details to fill in from your real experience.");
  for (const line of outlineLines(ev.answer_outline)) {
    if (line.bullet) w.bullets([line.text]);
    else w.text(line.text, { indent: 10 });
  }
  w.muted(`Weighted score ${ev.weighted_score}/100 · confidence ${ev.confidence}`);
}

function responseBlock(w: Writer, a: AttemptView) {
  if (a.status === "skipped") return w.muted("Skipped.", 10);
  if (a.status === "not_reached") return w.muted("Not reached before the interview ended.", 10);
  w.quote(a.response_text);
  if (a.followup_text) {
    w.gap(4);
    w.label("Follow-up", a.followup_text);
    w.quote(a.followup_response_text || "(no follow-up answer)");
  }
}

export interface ReportOptions {
  /** Uncompressed output (for tests that inspect the PDF's text). */
  compress?: boolean;
}

export async function reportPdf(d: SessionDetail, history: SessionPoint[] = [], opts: ReportOptions = {}): Promise<Buffer> {
  const cfg = getConfig();
  const s = d.session;
  const doc = new PDFDocument({
    size: "LETTER",
    margin: MARGIN,
    bufferPages: true,
    compress: opts.compress ?? true,
    info: { Title: `${s.role} interview report`, Author: "TreTechPro.ai", Subject: `${cfg.product} ${cfg.version}` },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve) => doc.on("end", () => resolve()));
  const w = new Writer(doc);
  const date = new Date(s.started_at).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" });

  // 1. Title and session configuration
  doc.font("Helvetica-Bold").fontSize(20).fillColor(INK).text(clean(`${s.role} Interview Report`));
  w.muted(`${cfg.product} ${cfg.version}`, 10);
  w.gap(6);
  w.text(`${LEVEL_LABELS[s.experience_level]} · ${s.mode_label} · ${date} UTC`);
  w.muted(
    `Answers: ${s.response_mode === "voice" ? "spoken (transcribed)" : "typed"}${s.time_limit_minutes ? ` · time limit ${s.time_limit_minutes} min` : ""} · rubric v${s.rubric_version}`,
  );

  // 2. Overall score and readiness band
  const o = d.original;
  w.heading("Overall score and readiness");
  if (o) {
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(40).fillColor(INK).text(String(o.overall_score), MARGIN, y, { width: 90 });
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("overall / 100", MARGIN, doc.y, { width: 90 });
    const after = doc.y;
    doc.font("Helvetica-Bold").fontSize(14).fillColor(INK).text(clean(o.readiness_band), MARGIN + 110, y + 6, { width: 380 });
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(MUTED)
      .text(
        clean(
          `Behavioral ${o.behavioral_average ?? "-"} · Technical knowledge ${o.technical_knowledge_average ?? "-"} · Technical scenario ${o.technical_scenario_average ?? "-"}` +
            (d.latest && d.latest.overall_score !== o.overall_score ? ` · With retries: ${d.latest.overall_score}` : ""),
        ),
        MARGIN + 110,
        doc.y + 2,
        { width: 380 },
      );
    doc.x = MARGIN;
    doc.y = Math.max(after, doc.y) + 6;
    w.muted(`${o.notes} Readiness bands: 0-49 foundation building · 50-69 developing · 70-84 proficient · 85-100 strong practice performance.`);
  } else {
    w.text("The evaluation is not available yet.");
  }

  // 3-5. Category breakdowns
  for (const cat of ["behavioral", "technical_knowledge", "technical_scenario"] as Category[]) {
    const dims = d.category_dimension_averages[cat];
    if (!dims.length) continue;
    const avg = cat === "behavioral" ? o?.behavioral_average : cat === "technical_knowledge" ? o?.technical_knowledge_average : o?.technical_scenario_average;
    w.heading(`${CATEGORY_LABELS[cat]} breakdown (average ${avg ?? "-"})`, 13);
    for (const x of dims) w.meter(x.label, x.average, x.weight);
  }

  // 8. Top three improvement priorities
  if (d.coaching) {
    w.heading("Top three improvement priorities");
    d.coaching.coaching_actions.forEach((a, i) => {
      w.ensure(40);
      w.text(`${i + 1}. ${a.title}`, { bold: true });
      w.text(a.detail, { indent: 14 });
      if (a.related_question_ids.length) w.text(`Related: ${a.related_question_ids.join(", ")}`, { indent: 14, size: 9, color: MUTED });
      w.gap(4);
    });
    if (d.coaching.overall_notes) w.text(d.coaching.overall_notes, { italic: true });
  }

  // 6-7. Per question: response, scores, strengths, gaps, suggested outline
  doc.addPage();
  w.heading("Questions, answers and feedback", 16);
  for (const q of d.questions) {
    w.ensure(90);
    w.rule();
    w.muted(`Q${q.position} · ${q.question_id} · ${CATEGORY_LABELS[q.category]} · ${q.competency}`);
    w.text(q.question_text, { bold: true, size: 11 });
    for (const a of q.attempts) {
      w.gap(6);
      w.ensure(90); // keep the attempt heading with the start of its answer
      const title = a.kind === "interview" ? "Your original answer" : `Retry #${a.attempt_number - 1}`;
      w.text(`${title}${a.evaluation ? ` · ${a.evaluation.weighted_score}/100` : ""}`, { bold: true, color: ACCENT });
      responseBlock(w, a);
      if (a.comparison) {
        const c = a.comparison;
        w.gap(4);
        w.text(`Change vs attempt ${c.previous_attempt_number}: ${c.score_before} -> ${c.score_after} (${c.score_after - c.score_before >= 0 ? "+" : ""}${c.score_after - c.score_before})`, {
          bold: true,
        });
        w.text(c.summary);
        w.muted(c.deltas.map((x) => `${x.label} ${x.before} -> ${x.after}`).join(" · "));
        if (c.specific_changes.length) w.bullets(c.specific_changes);
      }
      if (a.evaluation) {
        w.gap(6);
        evaluationBlock(w, a.evaluation);
      }
    }
  }

  // 9. Retry comparison and session history
  w.heading("Retry comparison and session history");
  const retries = d.questions.flatMap((q) => q.attempts.filter((a) => a.comparison).map((a) => ({ q, a })));
  if (retries.length) {
    for (const { q, a } of retries) {
      const c = a.comparison!;
      w.text(`Q${q.position} (${q.question_id}) retry #${a.attempt_number - 1}: ${c.score_before} -> ${c.score_after} (${c.score_after - c.score_before >= 0 ? "+" : ""}${c.score_after - c.score_before})`);
    }
  } else {
    w.muted("No retries yet.", 10);
  }
  w.gap(6);
  w.text(`${s.role} · ${LEVEL_LABELS[s.experience_level]} sessions`, { bold: true });
  const rows = history.filter((h) => h.overall_score !== null).sort((a, b) => a.started_at.localeCompare(b.started_at));
  for (const h of rows) {
    const day = new Date(h.started_at).toLocaleDateString("en-US", { timeZone: "UTC" });
    const mark = h.session_id === s.id ? "  (this interview)" : "";
    const ver = h.rubric_version !== s.rubric_version ? " · non-equivalent rubric" : "";
    w.text(`${day} · ${h.mode_label} · ${h.overall_score} · ${h.readiness_band ?? ""}${ver}${mark}`, { size: 9.5, bold: h.session_id === s.id });
  }
  if (!rows.length) w.muted("No earlier sessions for this role and level.", 10);

  // Page footers
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(MUTED)
      .text(clean(`TreTechPro.ai · ${s.role} interview report · Page ${i + 1} of ${range.count}`), MARGIN, doc.page.height - 34, {
        width: doc.page.width - MARGIN * 2,
        align: "center",
        lineBreak: false,
      });
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

export function reportFilename(d: SessionDetail): string {
  const role = d.session.role.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `interview-report-${role}-${d.session.started_at.slice(0, 10)}.pdf`;
}
