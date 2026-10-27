import Link from "next/link";
import { type AnamVoice, avatarClientConfig, listAnamVoices, voiceId } from "@/lib/avatar";
import VoicePicker from "@/components/VoicePicker";

export const dynamic = "force-dynamic";

export default async function InterviewerSettings({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const cfg = await avatarClientConfig();
  if (cfg.provider !== "anam") {
    return (
      <div className="card">
        <h1>Interviewer settings</h1>
        <p>The realistic video interviewer isn&apos;t enabled. Add an <code>ANAM_API_KEY</code> to the server&apos;s environment to choose a voice.</p>
      </div>
    );
  }
  let voices: AnamVoice[] = [];
  let error: string | null = null;
  try {
    voices = await listAnamVoices();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const current = voiceId();
  const all = show === "all";
  const shown = voices
    .filter((v) => all || v.country === "US" || v.id === current)
    .sort((a, b) => Number(b.id === current) - Number(a.id === current) || (a.gender ?? "").localeCompare(b.gender ?? "") || a.displayName.localeCompare(b.displayName));

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1 style={{ marginBottom: 4 }}>Interviewer voice</h1>
          <p className="muted" style={{ margin: 0 }}>
            Choose how {cfg.interviewerName} sounds. Play a sample, then select a voice; new interviews use it right away.
          </p>
        </div>
        <Link className="btn secondary small" href={all ? "/settings/interviewer" : "/settings/interviewer?show=all"}>
          {all ? "Show American voices only" : "Show all accents"}
        </Link>
      </div>
      {error && <p className="alert error">Could not load voices from Anam: {error}</p>}
      {!error && <VoicePicker voices={shown} currentId={current} />}
      {!error && shown.length === 0 && <p className="muted">No voices matched. Try “Show all accents”.</p>}
    </div>
  );
}
