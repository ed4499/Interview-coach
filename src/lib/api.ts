import { NextResponse } from "next/server";
import { getCandidateId } from "./candidate";
import { ServiceError, requireSession } from "./interview";

export type RouteCtx<P extends Record<string, string>> = { params: Promise<P> };

/** Wraps a route handler: ServiceErrors become JSON errors; anything else is a 500. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      console.error("[api] unexpected error:", err);
      return NextResponse.json({ ok: false, error: "Something went wrong and the request was not saved. Please try again." }, { status: 500 });
    }
  };
}

export async function sessionFor(id: string) {
  const candidate = await getCandidateId();
  if (!candidate) throw new ServiceError("Interview session not found.", 404);
  return requireSession(id, candidate);
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === "object") return body as Record<string, unknown>;
  } catch {}
  throw new ServiceError("Invalid JSON body.");
}
