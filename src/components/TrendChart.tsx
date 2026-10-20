"use client";

import { useState } from "react";

interface Point {
  session_id: string;
  started_at: string;
  overall_score: number | null;
  mode_label: string;
}
interface Group {
  key: string;
  label: string;
  sessions: Point[];
}

const W = 640;
const H = 220;
const PAD = { l: 36, r: 16, t: 14, b: 30 };

/**
 * Overall score by session, one comparison group (same role, level, rubric) at a time.
 * Sessions from other groups are non-equivalent and are never mixed into one line.
 */
export default function TrendChart({ groups }: { groups: Group[] }) {
  const [gi, setGi] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const g = groups[gi];
  if (!g) return null;
  const pts = g.sessions.filter((p) => p.overall_score !== null);
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - (v / 100) * ih;
  const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.overall_score!)}`).join(" ");

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    pts.forEach((_, i) => Math.abs(x(i) - px) < Math.abs(x(best) - px) && (best = i));
    setHover(best);
  }

  return (
    <div>
      <div className="spread" style={{ marginBottom: 8 }}>
        {groups.length > 1 ? (
          <select value={gi} onChange={(e) => (setGi(Number(e.target.value)), setHover(null))} style={{ maxWidth: 360 }} aria-label="Comparison group">
            {groups.map((x, i) => (
              <option key={x.key} value={i}>
                {x.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="muted small">{g.label}</span>
        )}
        <button className="btn ghost small" onClick={() => setTable(!table)}>
          {table ? "Show chart" : "Show table"}
        </button>
      </div>
      {table ? (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Interview type</th>
              <th className="num">Overall</th>
            </tr>
          </thead>
          <tbody>
            {pts.map((p) => (
              <tr key={p.session_id}>
                <td>{new Date(p.started_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</td>
                <td>{p.mode_label}</td>
                <td className="num">{p.overall_score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Overall score by session for ${g.label}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            {[0, 25, 50, 75, 100].map((v) => (
              <g key={v}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
                <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
                  {v}
                </text>
              </g>
            ))}
            {pts.map((p, i) =>
              pts.length <= 8 || i === 0 || i === pts.length - 1 ? (
                <text key={p.session_id} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
                  {fmt(p.started_at)}
                </text>
              ) : null,
            )}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />}
            <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {pts.map((p, i) => (
              <circle key={p.session_id} cx={x(i)} cy={y(p.overall_score!)} r={hover === i ? 6 : 4.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
            ))}
            {pts.length > 0 && (
              <text x={x(pts.length - 1)} y={y(pts[pts.length - 1].overall_score!) - 12} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--ink)">
                {pts[pts.length - 1].overall_score}
              </text>
            )}
          </svg>
          {hover !== null && pts[hover] && (
            <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(pts[hover].overall_score!) / H) * 100}%` }}>
              <strong>{pts[hover].overall_score}</strong> · {fmt(pts[hover].started_at)}
              <div className="muted">{pts[hover].mode_label}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
