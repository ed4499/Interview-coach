import { notFound, redirect } from "next/navigation";
import { authEnabled } from "@/lib/auth";
import { getCurrentUser } from "@/lib/candidate";
import SignInForm from "@/components/SignInForm";

export const dynamic = "force-dynamic";

function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!authEnabled()) notFound();
  const next = safeNext((await searchParams).next);
  if (await getCurrentUser()) redirect(next);
  return (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <div className="card">
        <h1>Sign in</h1>
        <p className="muted">
          Sign in with your email to keep your interview history and reports on any device. We&apos;ll email you a 6-digit code: no password needed.
        </p>
        <SignInForm next={next} />
      </div>
    </div>
  );
}
