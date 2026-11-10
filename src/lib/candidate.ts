/**
 * Candidate identity. Signed-in candidates (optional email-code sign-in) use their
 * account's candidate id; everyone else gets an anonymous, httpOnly browser cookie id.
 * INTEGRATION POINT: to use the host site's login instead, return its user's id here.
 */
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { SESSION_TTL_MS, type User, userForSessionToken } from "./auth";

const ANON_COOKIE = "ttp_candidate";
export const SESSION_COOKIE = "ttp_session";
const secure = process.env.NODE_ENV === "production";

export async function getCurrentUser(): Promise<User | null> {
  return userForSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function getAnonymousId(): Promise<string | null> {
  return (await cookies()).get(ANON_COOKIE)?.value ?? null;
}

export async function getCandidateId(): Promise<string | null> {
  return (await getCurrentUser())?.candidate_id ?? (await getAnonymousId());
}

/** Route handlers only (cookies can't be set while rendering a page). */
export async function getOrCreateCandidateId(): Promise<string> {
  const existing = await getCandidateId();
  if (existing) return existing;
  const id = randomUUID();
  (await cookies()).set(ANON_COOKIE, id, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 365 });
  return id;
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: SESSION_TTL_MS / 1000 });
}

/** Sign-out: drop the session and start a fresh anonymous identity, so the next person on this device sees nothing. */
export async function clearIdentityCookies() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.set(ANON_COOKIE, randomUUID(), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 365 });
}
