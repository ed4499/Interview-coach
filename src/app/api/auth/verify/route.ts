import { NextResponse } from "next/server";
import { handler, readJson } from "@/lib/api";
import { verifyLoginCode } from "@/lib/auth";
import { getAnonymousId, setSessionCookie } from "@/lib/candidate";

/** Checks the code, signs in, and moves this browser's interviews into the account. */
export const POST = handler(async (req: Request) => {
  const { email, code } = await readJson(req);
  const r = verifyLoginCode(email, code, await getAnonymousId());
  await setSessionCookie(r.token);
  return NextResponse.json({ ok: true, signedIn: true, email: r.user.email, movedInterviews: r.movedInterviews });
});
