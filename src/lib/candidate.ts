/**
 * Candidate identity. Standalone builds use an anonymous, httpOnly cookie id.
 * INTEGRATION POINT: when embedding in TreTechPro.ai, return the signed-in user's id
 * from the host application's auth session here instead.
 */
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "ttp_candidate";

export async function getCandidateId(): Promise<string | null> {
  return (await cookies()).get(COOKIE)?.value ?? null;
}

/** Route handlers only (cookies can't be set while rendering a page). */
export async function getOrCreateCandidateId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  if (existing) return existing;
  const id = randomUUID();
  jar.set(COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return id;
}
