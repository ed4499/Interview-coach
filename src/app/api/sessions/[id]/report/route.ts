import { NextResponse } from "next/server";
import { type RouteCtx, handler, sessionFor } from "@/lib/api";
import { getSessionDetail } from "@/lib/interview";
import { reportFilename, reportPdf } from "@/lib/report";
import { getProgress } from "@/lib/progress";

/** The candidate's evaluation report, as a PDF download (the only report format offered). */
export const GET = handler(async (_req: Request, { params }: RouteCtx<{ id: string }>) => {
  const s = await sessionFor((await params).id);
  if (s.status !== "completed") return NextResponse.json({ ok: false, error: "The report is available once the interview has been evaluated." }, { status: 409 });
  const detail = getSessionDetail(s);
  const history = getProgress(s.candidate_id).sessions.filter((p) => p.role === s.role && p.experience_level === s.experience_level);
  const pdf = await reportPdf(detail, history);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${reportFilename(detail)}"`,
      "cache-control": "private, no-store",
    },
  });
});
