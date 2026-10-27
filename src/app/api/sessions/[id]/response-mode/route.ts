import { NextResponse } from "next/server";
import { type RouteCtx, handler, readJson, sessionFor } from "@/lib/api";
import { setResponseMode } from "@/lib/interview";

/** Switch an in-progress interview between typed and spoken answers. */
export const POST = handler(async (req: Request, { params }: RouteCtx<{ id: string }>) => {
  const s = await sessionFor((await params).id);
  const body = await readJson(req);
  const state = setResponseMode(s, body.response_mode, body.consent_to_audio_recording);
  return NextResponse.json({ ok: true, saved: true, state });
});
