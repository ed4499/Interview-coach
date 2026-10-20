import { NextResponse } from "next/server";
import { type RouteCtx, handler, sessionFor } from "@/lib/api";
import { completeSession } from "@/lib/interview";

export const maxDuration = 300;

export const POST = handler(async (_req: Request, { params }: RouteCtx<{ id: string }>) => {
  const s = await completeSession(await sessionFor((await params).id));
  return NextResponse.json({ ok: s.status === "completed", status: s.status, error: s.evaluation_error }, { status: s.status === "evaluation_failed" ? 502 : 200 });
});
