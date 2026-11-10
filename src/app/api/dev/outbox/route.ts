import { NextResponse } from "next/server";
import { isTestMode } from "@/lib/ai";
import { getDb } from "@/lib/db";

/** Test mode only: the latest captured email for an address (used by automated tests). */
export async function GET(req: Request) {
  if (!isTestMode()) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const to = new URL(req.url).searchParams.get("to") ?? "";
  const row = getDb().prepare(`SELECT subject, text FROM dev_outbox WHERE to_email = ? ORDER BY id DESC LIMIT 1`).get(to.toLowerCase());
  return NextResponse.json({ ok: !!row, email: row ?? null });
}
