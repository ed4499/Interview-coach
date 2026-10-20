/**
 * Dashboard metrics, one per retry_and_coaching.progress_metrics entry:
 * interview_count, overall_score_by_session, category_average_by_session,
 * STAR_dimension_trends, technical_skill_gaps, retry_improvement, role_and_level_history.
 *
 * comparison_rule: trends compare sessions with the same role, level and rubric
 * version; anything else is labelled non-equivalent.
 */
import { CATEGORY_LABELS, type Category, LEVEL_LABELS, dimensionLabel } from "./config";
import { type SessionDetail, getSessionDetail, listSessions } from "./interview";
import type { CoachingAction } from "./ai";

export interface SessionPoint {
  session_id: string;
  started_at: string;
  role: string;
  experience_level: string;
  mode_label: string;
  rubric_version: string;
  status: string;
  overall_score: number | null;
  latest_score: number | null;
  readiness_band: string | null;
  behavioral_average: number | null;
  technical_knowledge_average: number | null;
  technical_scenario_average: number | null;
  star: Record<string, number> | null;
  comparison_key: string;
}

export interface Recommendation {
  title: string;
  detail: string;
  source: string;
}

export interface Progress {
  interview_count: number;
  completed_count: number;
  sessions: SessionPoint[];
  /** Comparison groups (role + level + rubric version), most recent first. */
  groups: { key: string; label: string; sessions: SessionPoint[] }[];
  technical_skill_gaps: { dimension: string; category: string; average: number; samples: number }[];
  weakest_competencies: { competency: string; average: number; samples: number }[];
  retry_improvement: { retries: number; average_delta: number | null; best_delta: number | null };
  role_and_level_history: { role: string; level: string; sessions: number; last_at: string }[];
  recommendations: Recommendation[];
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export function comparisonKey(role: string, level: string, rubricVersion: string) {
  return `${role}|${level}|${rubricVersion}`;
}

export function getProgress(candidateId: string): Progress {
  const rows = listSessions(candidateId);
  const details: SessionDetail[] = rows.map((r) => getSessionDetail(r));
  const sessions: SessionPoint[] = details.map((d) => {
    const s = d.session;
    const star = d.category_dimension_averages.behavioral;
    return {
      session_id: s.id,
      started_at: s.started_at,
      role: s.role,
      experience_level: s.experience_level,
      mode_label: s.mode_label,
      rubric_version: s.rubric_version,
      status: s.status,
      overall_score: d.original?.overall_score ?? null,
      latest_score: d.latest?.overall_score ?? null,
      readiness_band: d.original?.readiness_band ?? null,
      behavioral_average: d.original?.behavioral_average ?? null,
      technical_knowledge_average: d.original?.technical_knowledge_average ?? null,
      technical_scenario_average: d.original?.technical_scenario_average ?? null,
      star: star.length ? Object.fromEntries(star.map((x) => [x.key, x.average])) : null,
      comparison_key: comparisonKey(s.role, s.experience_level, s.rubric_version),
    };
  });

  const groupMap = new Map<string, SessionPoint[]>();
  for (const p of sessions.filter((x) => x.overall_score !== null)) {
    groupMap.set(p.comparison_key, [...(groupMap.get(p.comparison_key) ?? []), p]);
  }
  const groups = [...groupMap.entries()].map(([key, ss]) => {
    const [role, level, ver] = key.split("|");
    return {
      key,
      label: `${role} · ${LEVEL_LABELS[level as keyof typeof LEVEL_LABELS] ?? level} · rubric v${ver}`,
      sessions: [...ss].sort((a, b) => a.started_at.localeCompare(b.started_at)),
    };
  });

  // Technical skill gaps: lowest average technical dimensions and competencies across completed sessions.
  const dimSamples = new Map<string, { category: Category; scores: number[] }>();
  const compSamples = new Map<string, number[]>();
  let retryDeltas: number[] = [];
  for (const d of details) {
    for (const q of d.questions) {
      const first = q.attempts.find((a) => a.attempt_number === 1)?.evaluation;
      if (first && q.category !== "behavioral") {
        for (const dim of first.dimensions) {
          const k = `${q.category}:${dim.key}`;
          const e = dimSamples.get(k) ?? { category: q.category, scores: [] };
          e.scores.push(dim.score);
          dimSamples.set(k, e);
        }
        compSamples.set(q.competency, [...(compSamples.get(q.competency) ?? []), first.weighted_score]);
      }
      retryDeltas = retryDeltas.concat(q.attempts.flatMap((a) => (a.comparison ? [a.comparison.score_after - a.comparison.score_before] : [])));
    }
  }
  const technical_skill_gaps = [...dimSamples.entries()]
    .map(([k, v]) => ({ dimension: dimensionLabel(k.split(":")[1]), category: CATEGORY_LABELS[v.category], average: avg(v.scores)!, samples: v.scores.length }))
    .sort((a, b) => a.average - b.average)
    .slice(0, 4);
  const weakest_competencies = [...compSamples.entries()]
    .map(([competency, xs]) => ({ competency, average: avg(xs)!, samples: xs.length }))
    .sort((a, b) => a.average - b.average)
    .slice(0, 4);

  const history = new Map<string, { role: string; level: string; sessions: number; last_at: string }>();
  for (const s of sessions) {
    const k = `${s.role}|${s.experience_level}`;
    const e = history.get(k) ?? { role: s.role, level: LEVEL_LABELS[s.experience_level as keyof typeof LEVEL_LABELS], sessions: 0, last_at: s.started_at };
    e.sessions += 1;
    if (s.started_at > e.last_at) e.last_at = s.started_at;
    history.set(k, e);
  }

  // Personalized practice recommendations: the latest completed session's coaching
  // actions, then the weakest STAR dimension and technical gap across history.
  const recommendations: Recommendation[] = [];
  const latestDone = details.find((d) => d.coaching);
  if (latestDone?.coaching) {
    for (const a of latestDone.coaching.coaching_actions as CoachingAction[]) {
      recommendations.push({ title: a.title, detail: a.detail, source: `Coaching from your ${latestDone.session.role} interview` });
    }
  }
  const starAgg = new Map<string, number[]>();
  for (const s of sessions) for (const [k, v] of Object.entries(s.star ?? {})) starAgg.set(k, [...(starAgg.get(k) ?? []), v]);
  const weakestStar = [...starAgg.entries()].map(([k, v]) => ({ k, a: avg(v)! })).sort((x, y) => x.a - y.a)[0];
  if (weakestStar && weakestStar.a < 75) {
    recommendations.push({
      title: `Strengthen the ${dimensionLabel(weakestStar.k)} part of your STAR stories`,
      detail: `Your average ${dimensionLabel(weakestStar.k)} score is ${weakestStar.a}. Retry a behavioral question and make this component explicit.`,
      source: "Behavioral trend",
    });
  }
  if (technical_skill_gaps[0] && technical_skill_gaps[0].average < 75) {
    const g = technical_skill_gaps[0];
    recommendations.push({
      title: `Practice ${g.dimension.toLowerCase()} in ${g.category.toLowerCase()} answers`,
      detail: `This is your lowest technical dimension (average ${g.average} across ${g.samples} answers).`,
      source: "Technical trend",
    });
  }

  return {
    interview_count: sessions.length,
    completed_count: sessions.filter((s) => s.overall_score !== null).length,
    sessions,
    groups,
    technical_skill_gaps,
    weakest_competencies,
    retry_improvement: {
      retries: retryDeltas.length,
      average_delta: avg(retryDeltas),
      best_delta: retryDeltas.length ? Math.max(...retryDeltas) : null,
    },
    role_and_level_history: [...history.values()].sort((a, b) => b.last_at.localeCompare(a.last_at)),
    recommendations,
  };
}

