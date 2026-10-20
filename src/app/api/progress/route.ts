import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { getCandidateId } from "@/lib/candidate";
import { getProgress } from "@/lib/progress";

export const GET = handler(async () => {
  const candidate = await getCandidateId();
  return NextResponse.json({ ok: true, progress: candidate ? getProgress(candidate) : null });
});
