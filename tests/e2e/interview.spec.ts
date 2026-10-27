import { expect, test } from "@playwright/test";
import fs from "node:fs";

const SHOTS = process.env.E2E_SCREENSHOTS;
const shot = async (page: import("@playwright/test").Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

test.beforeAll(() => fs.rmSync("var/e2e", { recursive: true, force: true }));

const STAR_ANSWER =
  "When I was on the service desk at my college IT office, our printers kept dropping off the network. My role was to find the cause. " +
  "I checked the DHCP leases, I reviewed the switch logs and I configured reservations for each printer. As a result tickets dropped and I learned to document fixes.";

test("full 15-question text interview, results, retry, dashboard and report", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Test mode")).toBeVisible();
  await shot(page, "01-dashboard-empty");
  await page.getByRole("link", { name: "Start your first mock interview" }).click();

  const roles = await page.locator("#role option").allTextContents();
  expect(roles.slice(1)).toHaveLength(17);
  await page.selectOption("#role", "Network Engineer");
  await page.getByText("Mid-Level").click();
  await shot(page, "02-setup");
  await page.getByRole("button", { name: "Start interview" }).click();

  // Pre-join lobby: camera is optional but recommended; the self-view is never uploaded.
  await expect(page.getByText("Ready to join your interview?")).toBeVisible();
  await expect(page.getByText("Recommended", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Turn camera on" }).click();
  await expect(page.locator(".self-view video")).toBeVisible();
  await shot(page, "02b-lobby");
  await page.getByRole("button", { name: "Join interview" }).click();
  await expect(page.locator(".captions")).toContainText("Hi, I'm Cara");
  await expect(page.locator(".self-view.compact video")).toBeVisible();

  const seen: string[] = [];
  for (let i = 1; i <= 15; i++) {
    await expect(page.getByText(`${i} of 15`)).toBeVisible();
    const chip = await page.locator(".card .chip.brand").first().textContent();
    seen.push(chip ?? "");
    // The interviewer reads each question aloud; captions show exactly what was said.
    await expect(page.locator(".captions")).toContainText((await page.locator(".question-text").textContent())!);
    if (i === 1) await shot(page, "03-question");
    // Short answer on Q1 triggers the (test-mode) follow-up.
    await page.locator("#answer").fill(i === 1 ? "I fixed a network outage." : STAR_ANSWER);
    await page.getByRole("button", { name: "Submit answer" }).click();
    if (i === 1) {
      await expect(page.getByText("Follow-up:")).toBeVisible();
      await expect(page.locator(".captions")).toHaveText("What specifically was your responsibility?");
      await shot(page, "04-followup");
      await page.locator("#answer").fill("I personally owned the outage ticket and coordinated the switch replacement.");
      await page.getByRole("button", { name: "Submit follow-up" }).click();
    }
    await expect(page.getByText(/Answer saved/)).toBeVisible();
  }
  expect(seen.filter((c) => c.startsWith("Behavioral"))).toHaveLength(5);
  expect(seen.filter((c) => c === "Technical knowledge")).toHaveLength(5);
  expect(seen.filter((c) => c === "Technical scenario")).toHaveLength(5);
  await expect(page.locator(".captions")).toContainText("That completes the interview");
  // No scores during the interview.
  await expect(page.locator(".score-pill")).toHaveCount(0);

  await page.getByRole("button", { name: "Finish & get feedback" }).click();
  await expect(page.getByText("Overall score / 100")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Your top three coaching priorities")).toBeVisible();
  await expect(page.locator("details.q")).toHaveCount(15);
  await page.locator("details.q").first().locator("summary").click();
  await expect(page.getByText("How to structure a stronger answer").first()).toBeVisible();
  await shot(page, "05-results");

  const firstScore = Number(await page.locator("details.q").first().locator("summary .score-pill").textContent());
  await page.getByRole("link", { name: "Retry this question" }).first().click();
  await page.waitForURL(/\/retry\//);
  await expect(page.getByRole("heading", { name: /Your original answer/ })).toBeVisible();
  await page.locator("#answer").fill(STAR_ANSWER + " I also verified connectivity from three floors and told my supervisor.");
  await page.getByRole("button", { name: "Submit and compare" }).click();
  await expect(page.getByText("Attempt 1 → attempt 2")).toBeVisible({ timeout: 60_000 });
  await shot(page, "06-retry-comparison");

  await page.getByRole("link", { name: "← Back to results" }).click();
  await page.waitForURL(/\/results$/);
  await page.locator("details.q").first().locator("summary").click();
  await expect(page.getByText("Your original answer").first()).toBeVisible();
  await expect(page.getByText("Retry #1").first()).toBeVisible();
  expect(Number(await page.locator("details.q").first().locator("summary .score-pill").textContent())).toBe(firstScore);

  const report = await page.request.get(page.url().replace("/results", "").replace("/interview/", "/api/sessions/") + "/report?format=json");
  expect(report.ok()).toBe(true);
  const json = await report.json();
  expect(json.questions).toHaveLength(15);
  expect(json.questions[0].attempts).toHaveLength(2);
  expect(json.questions[0].attempts[0].response_text).toBe("I fixed a network outage.");
  expect(json.questions[0].attempts[0].followup_response_text).toMatch(/owned the outage ticket/);
  expect(json.coaching.coaching_actions).toHaveLength(3);

  const reportPage = await page.context().newPage();
  await reportPage.goto(page.url().replace("/results", "").replace("/interview/", "/api/sessions/") + "/report?format=html");
  await expect(reportPage.getByText("Top three improvement priorities")).toBeVisible();
  await expect(reportPage.getByText("Retry comparison and session history")).toBeVisible();
  await shot(reportPage, "07-report");
  await reportPage.close();

  await page.goto("/");
  await expect(page.getByText("Your interview dashboard")).toBeVisible();
  await expect(page.getByText("Overall score by session")).toBeVisible();
  await expect(page.getByText("Practice recommendations")).toBeVisible();
  await shot(page, "08-dashboard");

  // Phone width: no horizontal page scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, "10-dashboard-mobile");
  await page.getByRole("link", { name: "Review" }).first().click();
  await page.waitForURL(/\/results$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, "11-results-mobile");
  await page.getByRole("link", { name: "Interviewer settings" }).click();
  await expect(page.getByText(/isn't enabled/)).toBeVisible();
});

test("hands-free voice interview: listens automatically, transcribes, and submits after a pause", async ({ page }) => {
  // Headless Chromium has no working speech recognition, so simulate one that "hears" a spoken answer.
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "en-US";
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      private timer: ReturnType<typeof setTimeout> | null = null;
      start(track?: unknown) {
        // Only the answer recorder passes a mic track; the lobby's support check doesn't.
        if (!track || (window as unknown as { __spoken?: boolean }).__spoken) return;
        this.timer = setTimeout(() => {
          (window as unknown as { __spoken?: boolean }).__spoken = true;
          const text = "When I worked the college help desk, my role was to fix a printer outage. I checked the DHCP leases and configured reservations, and tickets dropped.";
          this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
        }, 400);
      }
      stop() {
        if (this.timer) clearTimeout(this.timer);
        setTimeout(() => this.onend?.(), 50);
      }
    }
    for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
      Object.defineProperty(window, name, { value: FakeRecognition, configurable: true, writable: true });
    }
  });

  await page.goto("/interview/new");
  await page.selectOption("#role", "SOC Analyst");
  await page.getByText("Entry-Level").click();
  await page.getByText("Behavioral STAR (5 questions)").click();
  await page.getByText("Speak my answers").click();
  await expect(page.getByRole("button", { name: "Start interview" })).toBeDisabled();
  await page.getByText(/I consent to TreTechPro.ai recording/).click();
  await page.getByRole("button", { name: "Start interview" }).click();
  // Lobby: pick a microphone and see its level (Chromium's fake device plays a tone).
  await expect(page.locator("#mic-select option").first()).toBeAttached();
  await expect(page.getByText("✓ We can hear you.")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("✓ Speech-to-text works in this browser.")).toBeVisible({ timeout: 10_000 });
  await shot(page, "09a-mic-setup");
  await page.getByRole("button", { name: "Join interview" }).click();

  await expect(page.getByText("1 of 5")).toBeVisible();
  // The mic opens on its own once the interviewer finishes, and the transcript fills in.
  await expect(page.getByRole("button", { name: /Stop listening/ })).toBeVisible();
  await expect(page.locator("#answer")).toHaveValue(/college help desk/);
  await expect(page.getByText(/Submitting your answer in/)).toBeVisible({ timeout: 10_000 });
  await shot(page, "09-hands-free-countdown");
  // Auto-submit: the answer and its recording are saved, and the interviewer asks the next question.
  await expect(page.getByText(/Answer saved/)).toBeVisible({ timeout: 10_000 });
  // The short sample answer triggers a (test-mode) follow-up, which the interviewer asks right away.
  await expect(page.locator(".captions")).toHaveText("What specifically was your responsibility?");
  await expect(page.getByText("Follow-up:")).toBeVisible();

  // Mic toggle stops listening; turning it back on resumes.
  await expect(page.getByRole("button", { name: /Stop listening/ })).toBeVisible();
  await page.getByRole("button", { name: "🎙 Mic on" }).click();
  await expect(page.getByRole("button", { name: /Mic is off/ })).toBeVisible();
  await page.getByRole("button", { name: "🎙 Mic off" }).click();
  await expect(page.getByRole("button", { name: /Stop listening/ })).toBeVisible();

  // End early while listening: remaining questions score 0; the recording is playable on the results page.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "End interview" }).click();
  await expect(page.getByText("Overall score / 100")).toBeVisible({ timeout: 60_000 });
  await page.locator("details.q").first().locator("summary").click();
  await expect(page.locator("details.q").first().locator("blockquote")).toContainText("college help desk");
  const src = await page.locator("audio").first().getAttribute("src");
  expect(src).toMatch(/^\/api\/audio\//);
  const audio = await page.request.get(src!);
  expect(audio.ok()).toBe(true);
  expect((await audio.body()).length).toBeGreaterThan(100);
});

test("falls back to a voice-only interviewer when the video avatar can't connect", async ({ page }) => {
  const base = "http://localhost:3101";
  await page.goto(`${base}/interview/new`);
  await page.selectOption("#role", "Data Analyst");
  await page.getByText("Entry-Level").click();
  await page.getByText("Technical Scenarios (5 questions)").click();
  await page.getByRole("button", { name: "Start interview" }).click();
  await page.getByRole("button", { name: "Join interview" }).click();
  await expect(page.getByText(/continues with a voice-only interviewer/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".tile-label").first()).toContainText("(voice)");
  await expect(page.locator(".captions")).toContainText("Here's the first question.");
  await shot(page, "12-voice-fallback");
  // The interview itself is unaffected.
  await page.locator("#answer").fill(STAR_ANSWER);
  await page.getByRole("button", { name: "Submit answer" }).click();
  await expect(page.getByText(/Answer saved/)).toBeVisible();
  await expect(page.getByText("2 of 5")).toBeVisible();
});

test("warns up front when the browser can't transcribe speech (e.g. Opera) and falls back to typing", async ({ page }) => {
  // Simulate a browser that exposes speech recognition but can't reach a transcription service.
  await page.addInitScript(() => {
    class BrokenRecognition {
      lang = "en-US";
      continuous = false;
      interimResults = false;
      onresult: unknown = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      start() {
        setTimeout(() => {
          this.onerror?.({ error: "network" });
          this.onend?.();
        }, 100);
      }
      stop() {}
      abort() {}
    }
    for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
      Object.defineProperty(window, name, { value: BrokenRecognition, configurable: true, writable: true });
    }
  });
  await page.goto("/interview/new");
  await page.selectOption("#role", "Help Desk");
  await page.getByText("Mid-Level").click();
  await page.getByText("Behavioral STAR (5 questions)").click();
  await page.getByText("Speak my answers").click();
  await page.getByText(/I consent to TreTechPro.ai recording/).click();
  await page.getByRole("button", { name: "Start interview" }).click();
  // (Headless Chromium reports itself as Chrome, so this shows the "isn't working right now" variant.)
  await expect(page.getByText(/can't turn your speech into text|isn't working right now/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Google Chrome/).first()).toBeVisible();
  await shot(page, "13-unsupported-browser");
  await page.getByRole("button", { name: "Join interview" }).click();
  await expect(page.getByText("1 of 5")).toBeVisible();
  // Hands-free starts switched off; the candidate can type and submit.
  await expect(page.getByRole("checkbox", { name: /Hands-free/ })).not.toBeChecked();
  await page.locator("#answer").fill(STAR_ANSWER);
  await page.getByRole("button", { name: "Submit answer" }).click();
  await expect(page.getByText(/Answer saved/)).toBeVisible();
});
