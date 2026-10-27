/**
 * What the video interviewer says around the bank questions. Deliberately neutral: no
 * praise or judgement between questions (scores stay hidden until the end), and the
 * questions themselves are always read verbatim.
 */
const ACKS = ["Thank you.", "Okay, thank you.", "Thanks for that.", "Alright, thank you."];

const CATEGORY_INTROS: Record<string, string> = {
  behavioral: "Let's start with some behavioral questions about your past experience.",
  technical_knowledge: "Now let's move on to some technical knowledge questions.",
  technical_scenario: "Next, I'll describe a few scenarios. Walk me through how you would handle each one.",
};

export function introLine(o: { name: string; role: string; total: number; resuming: boolean; position: number }): string {
  if (o.resuming) return `Welcome back. Let's continue where we left off, with question ${o.position} of ${o.total}.`;
  return (
    `Hi, I'm ${o.name}, and I'll be your interviewer today for the ${o.role} role. ` +
    `I'll ask you ${o.total} questions. Take your time, and answer as you would in a real interview. ` +
    `Once you've finished each answer, we'll move on to the next question.`
  );
}

/** Spoken before a primary question; adds a section intro when the category changes. */
export function questionLine(o: { position: number; text: string; category: string; previousCategory: string | null }): string {
  const first = o.previousCategory === null;
  const parts: string[] = first ? [] : [ACKS[(o.position - 2) % ACKS.length]];
  if (o.category !== o.previousCategory && CATEGORY_INTROS[o.category]) parts.push(CATEGORY_INTROS[o.category]);
  parts.push(first ? "Here's the first question." : "Next question.", o.text);
  return parts.join(" ");
}

export function followupLine(text: string): string {
  return text;
}

export function closingLine(timeUp: boolean): string {
  return timeUp
    ? "We're out of time, so let's stop here. Thank you for your time today. Your feedback will be ready in a moment."
    : "That completes the interview. Thank you for your time today. Your feedback will be ready in a moment.";
}
