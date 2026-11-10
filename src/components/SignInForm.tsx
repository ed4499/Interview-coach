"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function post(url: string, body: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
    return data;
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await post("/api/auth/request-code", { email });
      setEmail(data.email);
      setStep("code");
      setInfo(`We sent a 6-digit code to ${data.email}. It expires in 10 minutes; check your spam folder if it doesn't arrive.`);
      setCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/api/auth/verify", { email, code });
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (step === "email") {
    return (
      <form onSubmit={sendCode}>
        <label htmlFor="email">Email address</label>
        <input id="email" type="text" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        {error && (
          <p className="alert error small" role="alert" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
        <button className="btn" type="submit" disabled={busy || !email.trim()} style={{ marginTop: 16 }}>
          {busy ? "Sending…" : "Email me a code"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={verify}>
      {info && <p className="alert small">{info}</p>}
      <label htmlFor="code">6-digit code</label>
      <input
        id="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
        style={{ fontSize: "1.4rem", letterSpacing: "0.3em", maxWidth: 220 }}
        autoFocus
        required
      />
      {error && (
        <p className="alert error small" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn" type="submit" disabled={busy || code.replace(/\s/g, "").length !== 6}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <button type="button" className="btn ghost small" disabled={busy || cooldown > 0} onClick={() => sendCode()}>
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </button>
        <button
          type="button"
          className="btn ghost small"
          onClick={() => {
            setStep("email");
            setCode("");
            setError(null);
            setInfo(null);
          }}
        >
          Use a different email
        </button>
      </div>
    </form>
  );
}
