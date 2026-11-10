import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { handler } from "@/lib/api";
import { endSession } from "@/lib/auth";
import { SESSION_COOKIE, clearIdentityCookies } from "@/lib/candidate";

export const POST = handler(async () => {
  endSession((await cookies()).get(SESSION_COOKIE)?.value);
  await clearIdentityCookies();
  return NextResponse.json({ ok: true, signedOut: true });
});
