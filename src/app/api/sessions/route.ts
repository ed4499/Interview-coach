import { NextResponse } from "next/server";
import { handler, readJson } from "@/lib/api";
import { getOrCreateCandidateId } from "@/lib/candidate";
import { createSession } from "@/lib/interview";

export const POST = handler(async (req: Request) => {
  const candidate = await getOrCreateCandidateId();
  const s = createSession(candidate, await readJson(req));
  return NextResponse.json({ ok: true, saved: true, session_id: s.id }, { status: 201 });
});
