import { NextResponse } from "next/server";
import { type RouteCtx, handler, readJson, sessionFor } from "@/lib/api";
import { submitAnswer } from "@/lib/interview";

export const POST = handler(async (req: Request, { params }: RouteCtx<{ id: string }>) => {
  const s = await sessionFor((await params).id);
  const state = await submitAnswer(s, await readJson(req));
  return NextResponse.json({ ok: true, saved: true, state });
});
