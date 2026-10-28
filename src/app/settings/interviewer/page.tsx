import { notFound } from "next/navigation";
import { type AnamVoice, avatarClientConfig, listAnamVoices, resolveVoiceId, voiceSettingsEnabled } from "@/lib/avatar";
import { mergeVoices } from "@/lib/anamVoiceCatalog";
import VoicePicker from "@/components/VoicePicker";

export const dynamic = "force-dynamic";

const byName = (a: AnamVoice, b: AnamVoice) => (a.gender ?? "").localeCompare(b.gender ?? "") || a.displayName.localeCompare(b.displayName);

export default async function InterviewerSettings() {
  if (!voiceSettingsEnabled()) notFound();
  const cfg = await avatarClientConfig();
  if (cfg.provider !== "anam") {
    return (
      <div className="card">
        <h1>Interviewer settings</h1>
        <p>The realistic video interviewer isn&apos;t enabled. Add an <code>ANAM_API_KEY</code> to the server&apos;s environment to choose a voice.</p>
      </div>
    );
  }
  let apiVoices: AnamVoice[] = [];
  let apiError: string | null = null;
  try {
    apiVoices = await listAnamVoices();
  } catch (err) {
    apiError = err instanceof Error ? err.message : String(err);
  }
  const voices = mergeVoices(apiVoices);
  const { id: current, source } = await resolveVoiceId();
  const currentVoice = voices.find((v) => v.id === current);
  const american = voices.filter((v) => v.country === "US").sort(byName);
  const others = voices.filter((v) => v.country !== "US").sort(byName);

  return (
    <div className="stack">
      <div>
        <h1 style={{ marginBottom: 4 }}>Interviewer voice</h1>
        <p className="muted" style={{ margin: 0 }}>
          Choose how {cfg.interviewerName} sounds. Play a sample, then click <strong>Use this voice</strong>; new interviews use it right away.
        </p>
      </div>

      <div className="card">
        <strong>Current voice: {currentVoice?.displayName ?? "Custom voice"}</strong>
        <div className="muted small">
          {source === "chosen" && "Chosen on this page (or set in the server environment)."}
          {source === "default" && "This is the app's default voice. Pick a voice below to change it."}
        </div>
      </div>

      {apiError && <p className="alert small">Anam&apos;s voice list couldn&apos;t be loaded ({apiError}), so only Anam&apos;s standard voices are shown.</p>}

      {american.length > 0 && (
        <section className="stack">
          <h2>American voices</h2>
          <VoicePicker voices={american} currentId={current} />
        </section>
      )}

      <section className="stack">
        <h2>{american.length > 0 ? "More voices" : "Voices"}</h2>
        <p className="muted small" style={{ margin: 0 }}>
          {american.length > 0
            ? "Other accents and voices Anam hasn't labeled with an accent. Play a sample to hear it."
            : "Anam doesn't label these voices with an accent, so play the samples and pick the one that sounds American to you."}
        </p>
        <VoicePicker voices={others} currentId={current} showReset={source === "chosen"} />
      </section>
    </div>
  );
}
