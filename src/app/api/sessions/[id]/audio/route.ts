import { NextResponse } from "next/server";
import { type RouteCtx, handler, sessionFor } from "@/lib/api";
import { MAX_AUDIO_BYTES, ServiceError, saveAudio } from "@/lib/interview";

/** Uploads one consented voice recording (multipart field "audio"). */
export const POST = handler(async (req: Request, { params }: RouteCtx<{ id: string }>) => {
  const s = await sessionFor((await params).id);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_AUDIO_BYTES + 64 * 1024) throw new ServiceError("The recording is too large.", 413);
  const form = await req.formData();
  const file = form.get("audio");
  if (!(file instanceof Blob)) throw new ServiceError("No audio file received.");
  const saved = saveAudio(s, Buffer.from(await file.arrayBuffer()), file.type || "audio/webm");
  return NextResponse.json({ ok: true, saved: true, audio_id: saved.id, audio_uri: saved.uri }, { status: 201 });
});
