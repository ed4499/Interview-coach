"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

/** Header sign-in / signed-in state. Hidden entirely when sign-in isn't configured. */
export default function AccountMenu({ email }: { email: string | null }) {
  const router = useRouter();
  const path = usePathname();
  const [busy, setBusy] = useState(false);
  if (!email) {
    if (path === "/signin") return null;
    return (
      <Link className="account-link" href={`/signin?next=${encodeURIComponent(path)}`}>
        Sign in
      </Link>
    );
  }
  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/signout", { method: "POST" }).catch(() => null);
    router.replace("/");
    router.refresh();
    setBusy(false);
  }
  return (
    <span className="account">
      <span className="account-email" title={email}>
        {email}
      </span>
      <button className="account-link" onClick={signOut} disabled={busy}>
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </span>
  );
}
