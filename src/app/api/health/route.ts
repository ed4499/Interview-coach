import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Liveness check for the host: confirms the database opens and the question bank is loaded. */
export function GET() {
  try {
    const { n } = getDb().prepare(`SELECT COUNT(*) AS n FROM questions`).get() as { n: number };
    return NextResponse.json({ ok: n === 255, questions: n }, { status: n === 255 ? 200 : 500 });
  } catch (err) {
    console.error("[health] database check failed:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
