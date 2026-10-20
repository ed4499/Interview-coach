import { NextResponse } from "next/server";
import { type RouteCtx, handler, sessionFor } from "@/lib/api";
import { getSessionDetail } from "@/lib/interview";
import { reportHtml, reportJson } from "@/lib/report";
import { getProgress } from "@/lib/progress";

export const GET = handler(async (req: Request, { params }: RouteCtx<{ id: string }>) => {
  const s = await sessionFor((await params).id);
  if (s.status !== "completed") return NextResponse.json({ ok: false, error: "The report is available once the interview has been evaluated." }, { status: 409 });
  const detail = getSessionDetail(s);
  const history = getProgress(s.candidate_id).sessions.filter((p) => p.role === s.role && p.experience_level === s.experience_level);
  const format = new URL(req.url).searchParams.get("format") ?? "html";
  const stamp = s.started_at.slice(0, 10);
  if (format === "json") {
    return new NextResponse(JSON.stringify({ ...reportJson(detail), session_history: history }, null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="interview-report-${stamp}.json"` },
    });
  }
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new NextResponse(reportHtml(detail, history), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...(download ? { "content-disposition": `attachment; filename="interview-report-${stamp}.html"` } : {}),
    },
  });
});
