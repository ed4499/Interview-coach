import { NextResponse } from "next/server";
import { type RouteCtx, handler, readJson, sessionFor } from "@/lib/api";
import { retryQuestion } from "@/lib/interview";

export const maxDuration = 120;

export const POST = handler(async (req: Request, { params }: RouteCtx<{ id: string }>) => {
  const s = await sessionFor((await params).id);
  const r = await retryQuestion(s, await readJson(req));
  return NextResponse.json({ ok: r.evaluated, saved: true, ...r }, { status: r.evaluated ? 201 : 502 });
});
