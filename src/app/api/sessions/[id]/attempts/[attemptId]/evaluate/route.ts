import { NextResponse } from "next/server";
import { type RouteCtx, handler, sessionFor } from "@/lib/api";
import { evaluateRetry } from "@/lib/interview";

export const maxDuration = 120;

/** Re-runs evaluation for a saved retry whose evaluation previously failed. */
export const POST = handler(async (_req: Request, { params }: RouteCtx<{ id: string; attemptId: string }>) => {
  const { id, attemptId } = await params;
  await evaluateRetry(await sessionFor(id), attemptId);
  return NextResponse.json({ ok: true });
});
