"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function del() {
    if (!confirm("Permanently delete this interview, its answers, recordings and evaluations?")) return;
    setBusy(true);
    const res = await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) alert("The interview could not be deleted. Please try again.");
    router.refresh();
  }
  return (
    <button className="btn ghost small" onClick={del} disabled={busy} aria-label="Delete interview">
      Delete
    </button>
  );
}
