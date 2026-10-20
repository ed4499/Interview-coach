import { INTERVIEW_MODES, LEVEL_LABELS, LEVELS, getConfig } from "@/lib/config";
import SetupForm from "@/components/SetupForm";

export default function NewInterviewPage() {
  const cfg = getConfig();
  return (
    <div className="stack">
      <div>
        <h1>Set up your mock interview</h1>
        <p className="muted">
          Choose your target role and level. You&apos;ll get one question at a time, exactly as a real interviewer would ask it, and detailed
          feedback once you finish.
        </p>
      </div>
      <SetupForm
        roles={cfg.roles}
        levels={LEVELS.map((l) => ({ value: l, label: LEVEL_LABELS[l], hint: cfg.experience_level_guidance[l].focus }))}
        modes={Object.entries(INTERVIEW_MODES).map(([value, m]) => ({ value, label: m.label }))}
      />
    </div>
  );
}
