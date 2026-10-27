import { NextResponse } from "next/server";
import { type RouteCtx, handler, sessionFor } from "@/lib/api";
import { AvatarUnavailableError, createAnamSessionToken } from "@/lib/avatar";
import { ServiceError } from "@/lib/interview";

// A full interview needs ~20 short avatar sessions; cap per interview to bound cost if abused.
const MAX_TOKENS_PER_INTERVIEW = 80;
const issued = new Map<string, number>();

/** Issues a short-lived Anam session token so the browser can stream the video interviewer. */
export const POST = handler(async (_req: Request, { params }: RouteCtx<{ id: string }>) => {
  const s = await sessionFor((await params).id);
  if (s.status !== "in_progress") throw new ServiceError("This interview is no longer in progress.", 409);
  const n = issued.get(s.id) ?? 0;
  if (n >= MAX_TOKENS_PER_INTERVIEW) throw new ServiceError("The video interviewer limit for this interview was reached.", 429);
  try {
    const sessionToken = await createAnamSessionToken();
    issued.set(s.id, n + 1);
    return NextResponse.json({ ok: true, sessionToken }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof AvatarUnavailableError) throw new ServiceError(err.message, 503);
    throw err;
  }
});
