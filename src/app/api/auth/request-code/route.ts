import { NextResponse } from "next/server";
import { handler, readJson } from "@/lib/api";
import { requestLoginCode } from "@/lib/auth";

/** Emails a 6-digit sign-in code. */
export const POST = handler(async (req: Request) => {
  const { email } = await readJson(req);
  const client = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const r = await requestLoginCode(email, client);
  return NextResponse.json({ ok: true, sent: true, email: r.email });
});
