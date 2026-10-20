import { NextResponse } from "next/server";
import { type RouteCtx, handler, sessionFor } from "@/lib/api";
import { deleteSession, getInterviewState, getSessionDetail } from "@/lib/interview";

export const GET = handler(async (_req: Request, { params }: RouteCtx<{ id: string }>) => {
  const s = await sessionFor((await params).id);
  // Mock interview mode: while in progress only the interview state is returned, never scores.
  if (s.status === "in_progress") return NextResponse.json({ ok: true, state: getInterviewState(s) });
  return NextResponse.json({ ok: true, state: getInterviewState(s), detail: getSessionDetail(s) });
});

export const DELETE = handler(async (_req: Request, { params }: RouteCtx<{ id: string }>) => {
  deleteSession(await sessionFor((await params).id));
  return NextResponse.json({ ok: true, deleted: true });
});
