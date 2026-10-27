import { describe, expect, it } from "vitest";
import { HandsFreeTimer } from "@/lib/handsFree";

describe("hands-free answer timing", () => {
  const opts = { silenceMs: 3500, countdownMs: 3000 };

  it("waits indefinitely until the candidate starts speaking", () => {
    const t = new HandsFreeTimer(opts);
    expect(t.state(60_000)).toEqual({ phase: "waiting" });
  });

  it("does not interrupt short thinking pauses", () => {
    const t = new HandsFreeTimer(opts);
    t.speech(0);
    expect(t.state(3000).phase).toBe("speaking");
    t.speech(3200); // resumed talking
    expect(t.state(6000).phase).toBe("speaking");
  });

  it("counts down after a long pause and submits at zero", () => {
    const t = new HandsFreeTimer(opts);
    t.speech(0);
    expect(t.state(4500)).toEqual({ phase: "countdown", remainingMs: 2000 });
    expect(t.state(6500)).toEqual({ phase: "submit" });
  });

  it("cancels the countdown when speech resumes or the candidate asks for more time", () => {
    const t = new HandsFreeTimer(opts);
    t.speech(0);
    expect(t.state(5000).phase).toBe("countdown");
    t.speech(5100);
    expect(t.state(5200).phase).toBe("speaking");
    expect(t.state(9000).phase).toBe("countdown");
    t.extend(9000);
    expect(t.state(12_000).phase).toBe("speaking");
  });

  it("never submits while paused", () => {
    const t = new HandsFreeTimer(opts);
    t.speech(0);
    t.pause();
    expect(t.state(100_000)).toEqual({ phase: "waiting" });
  });
});
