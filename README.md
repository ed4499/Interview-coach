# TreTechPro.ai STAR Interview Coach 3.0

An AI mock-interview simulator built from the client's three spec files (in `data/`) and the
development instructions (in `docs/`). Candidates pick one of 17 roles, an experience level and an
interview type. They answer role-specific questions one at a time by text or voice, then get STAR and
technical scoring, coaching, and per-question retries, and can track progress on a dashboard.

**Stack:** Next.js 16 (App Router, TypeScript) · SQLite (better-sqlite3) · Claude via the official
Anthropic SDK (`claude-opus-5-5`) · browser Web Speech API + MediaRecorder for voice.

## Quick start

```bash
npm install
cp .env.example .env.local        # set ANTHROPIC_API_KEY
npm run validate-data             # verify the JSON / CSV / prompt files
npm run build && npm start        # http://localhost:3000
```

The database (`var/interview-coach.sqlite`) is created on first use and the CSV bank is imported
automatically (also available as `npm run db:seed`).

**Test mode (no API key):** `INTERVIEW_AI_MODE=test npm start` swaps the AI for an offline
keyword heuristic so QA can walk through the whole product. Every page shows a yellow
"Test mode" banner. Its scores are **not** real evaluations.

| Script | Purpose |
|---|---|
| `npm run validate-data` | Validates JSON structure, CSV bank, JSON↔CSV agreement, prompt file; prints 5/5/5 per role |
| `npm test` | Unit and integration tests (Vitest, 42 tests) |
| `npm run test:e2e` | Browser end-to-end tests (Playwright, test mode). Set `PLAYWRIGHT_CHROMIUM_PATH` to use a preinstalled Chromium |
| `npm run typecheck` | TypeScript check |

## Deploy a test link on Render

`render.yaml` is a Render Blueprint with the build/start commands, Node 22, a health check
(`/api/health`) and a 1 GB persistent disk at `/var/data` for the database and recordings.

1. Render dashboard → **New → Blueprint** → connect this GitHub repo → it reads `render.yaml`.
2. Enter the two secrets when prompted: `ANTHROPIC_API_KEY` and `SITE_PASSWORD`
   (visitors sign in with any username and that password).
3. **Apply.** The first build takes a few minutes; the link is `https://<service-name>.onrender.com`.

Every push to `main` redeploys automatically. To demo without an API key, add
`INTERVIEW_AI_MODE=test` in the service's Environment tab (scores are then fake and labelled).

## Video interviewer (avatar)

The interview runs like a video call. A pre-join lobby offers an optional camera self-view
(recommended, shown only to the candidate, never recorded or uploaded). Then an AI interviewer
reads each question aloud with on-screen captions, and the candidate gets camera/sound/repeat/end
controls.

* **Realistic video avatar:** [Anam](https://anam.ai) streams a lifelike interviewer over WebRTC.
  Set `ANAM_API_KEY` (from lab.anam.ai) to enable it. The avatar only says text this app sends
  (`llmId: CUSTOMER_CLIENT_V1` disables Anam's own LLM; the SDK runs with input audio disabled), so
  questions stay verbatim and scoring stays ours. Anam recordings and transcripts are turned off.
* **Cost control:** Anam bills per second while a session is open, and smaller plans cap session
  length (Free 3 min, Starter 5, Explorer 10, Growth+ 2 h). By default the avatar connects to ask each
  question, then disconnects while the candidate answers, leaving its last frame on screen
  (`AVATAR_IDLE_SECONDS=0`, about 8 avatar-minutes per 15-question interview). On a Growth+ plan, set
  `AVATAR_IDLE_SECONDS=3600` and `AVATAR_MAX_SESSION_SECONDS=7200` for one continuous live session.
* **Customizing:** `ANAM_AVATAR_ID`, `ANAM_VOICE_ID` (from Anam's gallery or your own) and
  `INTERVIEWER_NAME`.
* **Natural idling:** while the candidate answers, the tile plays the avatar's official idle loop
  (Anam `idleVideoUrl`, refreshed every 30 minutes), so the interviewer blinks and moves like a person
  listening without keeping a billed live session open.
* **Voice:** the default is "Sophie" from Anam's standard voices (Anam's example voice "Cara" is
  British). `ANAM_VOICE_ID` overrides it.
* **Voice picker (hidden by default):** set `ENABLE_VOICE_SETTINGS=true` to show the **Interviewer
  settings** page (footer link, `/settings/interviewer`). It lists Anam's 18 standard voices
  (`src/lib/anamVoiceCatalog.ts`) plus any in the account, with samples, and saves a choice that new
  interviews use immediately. While the flag is off, the page and its save endpoint return 404 and any
  saved choice is ignored. Anyone who can sign in can use the page when it's on, so keep it off in
  production.
* **Hands-free voice answers** (voice mode, on by default, can be unticked): the mic opens when the
  interviewer finishes speaking. After 3.5 s without speech, a visible 3-second countdown starts
  ("Not done yet" / "Submit now"; talking again cancels it), then the answer submits and the
  interviewer continues. Nothing submits before the candidate has said something. Requires browser
  speech recognition (Chrome/Edge); elsewhere candidates record and submit manually.
* **Microphone:** in voice mode the lobby has a microphone picker with a live level meter, and the call
  has **Mic on/off** and **Microphone** controls. Recording and speech-to-text both use the chosen
  device (`SpeechRecognition.start(track)`, Chrome/Edge 135+; older browsers use the default mic).
  Listening pauses while the interviewer speaks. Speech-to-text errors are explained on screen,
  including "we can hear you but no words are transcribed".
* **Spoken answers by default:** the setup page preselects "Speak my answers" (the JSON config's
  `response_mode` default of `text` still applies to API callers). A typed interview can switch to
  spoken answers mid-interview with **🎙 Use microphone**, which asks for recording consent first.
* **Browser support for spoken answers:** speech-to-text uses the browser's service, which works in
  Google Chrome and Microsoft Edge. The setup page warns in other browsers, and the lobby runs a quick
  check. If transcription isn't available (e.g. Opera, Brave, Firefox), the candidate is told to switch
  browsers or type; hands-free starts off and recordings are still saved. *Planned:* server-side
  speech-to-text so voice answers work in every browser.
* **Fallback:** without a key, or if the video can't connect, the interviewer continues with the
  browser's built-in voice. The interview never stalls.
* Voice answers can only start recording after the interviewer finishes speaking, so its voice isn't
  transcribed into the answer.

Code: `src/lib/avatar.ts` (config + session tokens), `src/app/api/sessions/[id]/avatar-token`,
`src/components/avatar/drivers.ts` (provider-neutral driver interface: Anam, browser voice, test),
`src/lib/interviewerScript.ts` (neutral spoken transitions), `src/components/InterviewRunner.tsx`.

## How it works

```
Setup ─► Interview (one question at a time, ≤1 neutral follow-up each, no scores shown)
      ─► Finish ─► Evaluation (per question, per rubric) ─► Coaching summary (3 priorities)
      ─► Results ─► Retry any question (new attempt, same rubric) ─► Original vs retry comparison
      ─► Dashboard (history, trends, gaps, recommendations) · PDF report download
```

* **Claude proposes, code computes.** For each answer Claude returns per-dimension scores (0–100) with
  evidence quotes, gaps, tips, strengths, missing components and an answer outline. It uses
  structured JSON output whose schema allows *only* that category's rubric dimensions. The app then
  applies the weights, rounds once, averages and assigns readiness bands deterministically
  (`src/lib/scoring.ts`). This makes scoring consistent and auditable.
* **Prompts** start with the client's agent prompt verbatim, then the JSON `agent_rules`, the level
  guidance and the rubric (`src/lib/ai/prompts.ts`). Candidate text is passed inside tags as data, so
  instructions embedded in an answer are ignored. Outlines use `[placeholders]` for missing facts
  instead of inventing experience.
* **Refusal fallback:** requests use `fallbacks: "default"` so that if a safety classifier declines
  (possible for Pen Tester / SOC / AppSec content), the API re-runs on Anthropic's recommended fallback
  model. Any remaining refusal, truncation or malformed output becomes a clear, retryable error.
* **Nothing is lost on AI failure.** Answers are saved before any AI call. A failed follow-up
  decision simply skips the follow-up. A failed evaluation marks the session "Needs re-evaluation"
  with a one-click retry that only scores the missing answers. A failed retry score keeps the retry
  and offers "Score my saved retry". The UI shows "saved" only after the server confirms a commit.

## Configuration → implementation map

| JSON key | Where it is used |
|---|---|
| `roles`, `questions_per_role`, `questions[]` | `src/lib/config.ts` (Zod schema + cross-checks), `src/lib/questionBank.ts` (CSV import, 5/5/5 enforcement, selection) |
| `behavioral_weights` / `technical_weights` / `scenario_weights`, `evaluation_schema.rubrics` | `rubricFor()`; must match each other and sum to 100 |
| `evaluation_schema.per_dimension` / `per_question` | Structured-output schemas `src/lib/ai/schemas.ts`; stored in `evaluations` |
| `evaluation_schema.calculation`, `overall`, `scoring_anchors` | `src/lib/scoring.ts`; anchors are injected into the evaluation prompt |
| `agent_system_prompt` / agent prompt `.txt`, `agent_rules` | Base of every prompt (`src/lib/ai/prompts.ts`); the two copies are verified identical |
| `experience_level_guidance`, `experience_level_variants` | Prompt calibration for scoring and follow-up depth (questions themselves are never swapped) |
| `interview_configuration` (modes, defaults, optional fields) | Setup form + `createSession()`. Modes: full (15), behavioral (5), technical knowledge (5), technical scenarios (5), and the JSON's `technical_only` (10) |
| `adaptive_interview_policy` | `submitAnswer()`: max 1 follow-up per question, the 5 triggers, neutral style, level depth, timed mode drops follow-ups first |
| `response_storage_schema` | `attempts` table: question id + exact text, verbatim response, raw transcript, audio ref, follow-up Q/A, attempt number, timestamps, consent |
| `retry_and_coaching` (flow, retry_limit, comparison_rule) | Retry page follows the five flow steps; `retry_limit: null` = unlimited; trends only compare same role + level + rubric version |
| `retry_and_coaching.progress_metrics` | `src/lib/progress.ts` (one field per metric) → dashboard |
| `report_spec` (sections, formats, privacy) | `src/lib/report.ts`: all 9 sections in a server-generated PDF (pdfkit). By the client's decision, PDF is the only download offered (no JSON or HTML) |
| `features.*` | All enabled features are implemented (see the requirement map below) |

## Development instructions (PDF) → status

| # | Requirement | Implementation |
|---|---|---|
| 1 | Integrate the JSON configuration | Validated at startup and by `npm run validate-data`; mapped as above |
| 2 | Configure the AI agent | Client's prompt + rules; one question at a time; level-adapted; responses preserved verbatim; evaluation after the interview; coaching + retries |
| 3 | Import the question bank | CSV imported into `questions` (255 rows, 17 roles × 5/5/5) and cross-checked against the JSON; candidates only get their role's questions |
| 4 | Candidate setup | Role, level (Entry/Mid/Senior), type (Full 15 / Behavioral 5 / Technical Knowledge 5 / Technical Scenarios 5, plus Technical 10); optional time limit and job description |
| 5 | Voice or text responses | Text box, or voice with explicit consent: audio recorded (MediaRecorder) and saved, live transcription via Web Speech API, transcript editable before submit. Saved with question, session, role and level |
| 6 | Evaluation | STAR 20/20/40/20; technical accuracy/reasoning/completeness/communication; scenario framing/actions/validation/communication-risk; question, category and overall scores; readiness band |
| 7 | Coaching and improvement | Strengths, weaknesses, missing STAR components, knowledge gaps, candidate-grounded outlines, retries, original vs retry comparison with dimension deltas. Prompts forbid inventing accomplishments |
| 8 | Dashboard | Review interviews, original answers + evaluations, STAR/technical scores, trend chart, skill gaps, retry improvement, recommendations, report downloads, retry links, deletion |
| 9 | Adaptive interviewing | Level-calibrated scoring and follow-up depth; at most one follow-up per question, never replacing the primary questions |
| 10 | Testing and validation | See below |

### Pre-deployment checklist (section 10) → automated tests

| Check | Test |
|---|---|
| All 17 roles load | `tests/unit/data.test.ts`, e2e (role dropdown has 17) |
| Each role has exactly 15 primary questions | `data.test.ts`, `npm run validate-data`, e2e (15 asked: 5/5/5) |
| Behavioral → STAR evaluations | `interview.test.ts`, `evaluator.test.ts` (schema only allows S/T/A/R) |
| Technical → technical evaluations | same (technical and scenario rubrics) |
| Recordings and transcripts saved | `interview.test.ts` (audio + raw transcript linked, owner-only access), e2e voice test (real browser recording uploaded and playable) |
| Consistent structured scoring | `evaluator.test.ts` (strict schema, rejects missing/foreign dimensions, clamps, deterministic weighting) |
| Retries don't overwrite originals | `interview.test.ts` (new attempt rows; a DB trigger rejects any UPDATE of a saved response) |
| History and progress tracking | `interview.test.ts` (comparison groups, STAR trends, gaps, retry improvement), e2e dashboard |
| Reports show correct scores and feedback | `interview.test.ts` (PDF content), e2e (PDF download; legacy JSON/HTML formats not served) |

## Integrating into the existing TreTechPro.ai site

This was built standalone because the existing codebase wasn't available. The pieces are
separated so they can be moved in:

1. **Identity:** `src/lib/candidate.ts` uses an anonymous cookie. Replace `getCandidateId()` /
   `getOrCreateCandidateId()` with the site's signed-in user id. Nothing else changes.
2. **Branding:** all colors and the font live in CSS variables at the top of `src/app/globals.css`
   (light and dark). Swap in the site's palette/fonts and replace the header in `src/app/layout.tsx`.
3. **Database:** `src/lib/db.ts` holds the full schema (SQLite). For Postgres/MySQL, port the schema
   (including the immutability trigger) and replace `getDb()` usage in `src/lib/interview.ts`.
4. **Hosting options:** run it as its own service under a sub-path or subdomain (simplest), or copy
   `src/lib`, `src/components` and the routes into the site if it's also Next.js.
5. **Audio storage:** recordings go to `var/audio` (`AUDIO_STORAGE_DIR`). For multi-server or
   serverless hosting, move `saveAudio`/`getAudio` to object storage (e.g. S3) with private access.

Long-running work: finishing a full interview runs 15 evaluations (4 in parallel) plus a summary,
typically well under the 300 s route limit set in `complete/route.ts`. Serverless hosts must allow
that duration; the SQLite file and audio directory need persistent disk.

## Privacy, fairness and data handling

* Audio is recorded only with an explicit consent checkbox, stored outside the web root, and served
  only to its owner. **Only text is sent to the AI**; voice, accent and speaking speed are never scored.
  Prompts tell the evaluator not to penalize transcription errors or infer competence from
  demographic traits.
* Candidates can permanently delete an interview (answers, evaluations, recordings).
* No automatic retention period is enforced yet. The JSON says retention should be configured at
  deployment, so the client needs to choose a policy (e.g. a nightly job deleting sessions older than
  N days).
* Results always state that scores are coaching indicators, not hiring predictions.

## Known limitations

* **Live AI calls were not exercised during development** (no API key in the build environment).
  The Claude integration is covered by tests against a mocked SDK client, and the full product flow
  is verified end-to-end in test mode. Run one real interview with a key before launch to review
  feedback quality and latency.
* Live transcription relies on the browser's Web Speech API (best in Chrome and Edge; not in
  Firefox). Elsewhere the recording is still saved and the candidate types the answer. For
  consistent cross-browser transcription, add a server-side speech-to-text service behind the
  existing audio upload endpoint.
* Recording playback hides the browser's download option (`controlsList="nodownload"`), which deters but
  can't fully prevent saving audio a candidate can already hear.

## Project layout

```
data/                     client spec files (JSON config, CSV bank, agent prompt) — source of truth
docs/                     client development instructions (PDF)
src/lib/config.ts         config loading/validation, rubrics, modes, readiness bands
src/lib/questionBank.ts   CSV import, JSON cross-check, question selection
src/lib/db.ts             SQLite schema + bank import
src/lib/interview.ts      workflow service: sessions, answers, follow-ups, evaluation, retries, audio
src/lib/scoring.ts        deterministic weighted scoring
src/lib/progress.ts       dashboard metrics
src/lib/report.ts         PDF report (pdfkit)
src/lib/ai/               Claude client, prompts, schemas, test-mode evaluator
src/app/                  pages + API routes
src/components/           UI components (setup, runner, voice input, results, chart)
scripts/                  validate-data, seed
tests/unit, tests/e2e     Vitest + Playwright
```
