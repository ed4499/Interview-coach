import { NextResponse } from "next/server";
import { type RouteCtx, handler } from "@/lib/api";
import { getCandidateId } from "@/lib/candidate";
import { getAudio } from "@/lib/interview";

/** Access-controlled playback: only the candidate who recorded it can fetch it. */
export const GET = handler(async (_req: Request, { params }: RouteCtx<{ id: string }>) => {
  const candidate = await getCandidateId();
  const audio = candidate ? getAudio((await params).id, candidate) : null;
  if (!audio) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(audio.data), { headers: { "content-type": audio.mime_type, "cache-control": "private, no-store" } });
});
