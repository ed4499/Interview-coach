"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AvatarClientConfig } from "@/lib/avatar";
import type { InterviewState, InterviewStep } from "@/lib/interview";
import { closingLine, followupLine, introLine, questionLine } from "@/lib/interviewerScript";
import AnswerInput, { type AnswerValue, emptyAnswer } from "./AnswerInput";
import { AnamDriver, type AvatarDriver, type AvatarState, BrowserVoiceDriver, TestDriver } from "./avatar/drivers";
import MicSetup from "./MicSetup";
import { loadMicId } from "./mic";
import { type SpeechSupport, browserName, probeSpeechRecognition } from "./speechSupport";

interface Props {
  initial: InterviewState;
  levelLabel: string;
  categoryLabels: Record<string, string>;
  avatar: AvatarClientConfig;
}

const VIDEO_ID = "interviewer-video";

function useCountdown(deadline: string | null) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!deadline) return;
    const tick = () => setLeft(Math.max(0, Date.parse(deadline) - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [deadline]);
  return left;
}

function stepKey(step: InterviewStep): string {
  return step.type === "question" || step.type === "followup" ? `${step.type}:${step.question_id}` : step.type;
}

/** Camera self-view: shown only to the candidate, never recorded or uploaded. */
function useCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const toggle = useCallback(async () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStream(null);
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 }, audio: false });
      streamRef.current = s;
      setStream(s);
      setError(null);
    } catch {
      setError("Camera access was blocked or no camera was found. You can continue without it.");
    }
  }, []);
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);
  return { stream, error, toggle };
}

function SelfView({ stream, compact }: { stream: MediaStream | null; compact?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className={`self-view ${compact ? "compact" : ""}`}>
      {stream ? <video ref={ref} autoPlay muted playsInline aria-label="Your camera (only visible to you)" /> : <div className="cam-off">Camera off</div>}
      <span className="tile-label">You</span>
    </div>
  );
}

function SpeechCheck({ support }: { support: SpeechSupport }) {
  if (support === "checking") return <p className="hint">Checking speech-to-text…</p>;
  if (support === "ok") return <p className="hint status-good">✓ Speech-to-text works in this browser.</p>;
  return (
    <div className="alert error small" role="alert" style={{ marginTop: 8 }}>
      <strong>
        {support === "blocked" ? "Speech-to-text is blocked in this browser." : `${browserName()} can't turn your speech into text.`}
      </strong>{" "}
      Spoken answers currently work in <strong>Google Chrome</strong> and <strong>Microsoft Edge</strong>. To answer by voice, open this site in one of
      those browsers and start the interview there. Or join now and type your answers; your voice recordings are still saved.
    </div>
  );
}

export default function InterviewRunner({ initial, levelLabel, categoryLabels, avatar }: Props) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [answer, setAnswer] = useState<AnswerValue>(emptyAnswer);
  const [busy, setBusy] = useState(false);
  const [inputBusy, setInputBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [joined, setJoined] = useState(false);
  const [avatarState, setAvatarState] = useState<AvatarState>("idle");
  const [freezeFrame, setFreezeFrame] = useState<string | null>(null);
  const [videoLive, setVideoLive] = useState(false);
  const [videoMode, setVideoMode] = useState(avatar.provider === "anam");
  const [notice, setNotice] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [lastLine, setLastLine] = useState<string>("");
  const [handsFree, setHandsFree] = useState(true);
  const [micId, setMicId] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [micPanel, setMicPanel] = useState(false);
  useEffect(() => setMicId(loadMicId()), []);
  const [speechSupport, setSpeechSupport] = useState<SpeechSupport>("checking");
  const [micReady, setMicReady] = useState(false);
  // Check before the interview whether this browser can turn speech into text
  // (after mic permission is granted, so a pending prompt isn't mistaken for "blocked").
  useEffect(() => {
    if (state.response_mode !== "voice" || !micReady || speechSupport !== "checking") return;
    let cancelled = false;
    probeSpeechRecognition().then((r) => {
      if (cancelled) return;
      setSpeechSupport(r);
      if (r !== "ok") setHandsFree(false); // nothing to auto-submit without a transcript
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.response_mode, micReady]);
  const camera = useCamera();
  const left = useCountdown(state.deadline_at);
  const onBusyChange = useCallback((b: boolean) => setInputBusy(b), []);

  const driverRef = useRef<AvatarDriver | null>(null);
  const spokenRef = useRef<string | null>(null);
  const prevCategoryRef = useRef<string | null>(null);

  const step = state.step;
  const voice = state.response_mode === "voice";
  const timeUp = step.type === "time_up" || left === 0;
  const speaking = avatarState === "speaking" || avatarState === "connecting";

  const fallbackToVoice = useCallback((message: string) => {
    driverRef.current?.destroy();
    driverRef.current = new BrowserVoiceDriver({ onState: setAvatarState });
    setVideoMode(false);
    setNotice(`${message.replace(/\.?$/, ".")} The interview continues with a voice-only interviewer.`);
  }, []);

  const say = useCallback(
    async (text: string) => {
      setLastLine(text);
      const d = driverRef.current;
      if (!d) return;
      await d.say(text);
      // If the video avatar failed during this line, repeat it with the voice fallback.
      if (driverRef.current && driverRef.current !== d) await driverRef.current.say(text);
    },
    [],
  );

  function createDriver(): AvatarDriver {
    const cb = { onState: setAvatarState, onFreezeFrame: setFreezeFrame, onLiveChange: setVideoLive, onFatal: fallbackToVoice };
    if (avatar.provider === "test") return new TestDriver(cb);
    if (avatar.provider === "browser") return new BrowserVoiceDriver(cb);
    return new AnamDriver(
      VIDEO_ID,
      async () => {
        const res = await fetch(`/api/sessions/${state.session_id}/avatar-token`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.sessionToken) throw new Error(data.error ?? `HTTP ${res.status}`);
        return data.sessionToken as string;
      },
      avatar.idleMs,
      cb,
    );
  }

  useEffect(() => () => driverRef.current?.destroy(), []);

  // Speak whenever the interview moves to a new step.
  useEffect(() => {
    if (!joined) return;
    const key = timeUp && step.type !== "finished" ? "time_up" : stepKey(step);
    if (spokenRef.current === key) return;
    const firstLine = spokenRef.current === null;
    spokenRef.current = key;

    let text = "";
    if (key === "time_up" || step.type === "finished") {
      text = firstLine ? "" : closingLine(key === "time_up");
    } else if (step.type === "question") {
      if (firstLine) {
        const resuming = step.position > 1;
        text = `${introLine({ name: avatar.interviewerName, role: state.role, total: state.total_questions, resuming, position: step.position })} ${
          resuming ? step.question_text : questionLine({ position: step.position, text: step.question_text, category: step.category, previousCategory: null })
        }`;
      } else {
        text = questionLine({ position: step.position, text: step.question_text, category: step.category, previousCategory: prevCategoryRef.current });
      }
      prevCategoryRef.current = step.category;
    } else if (step.type === "followup") {
      text = firstLine ? `Welcome back. Before we move on, one follow-up. ${followupLine(step.followup_text)}` : followupLine(step.followup_text);
      prevCategoryRef.current = step.category;
    }
    if (text) void say(text);
  }, [joined, step, timeUp, state.role, state.total_questions, avatar.interviewerName, say]);

  function join() {
    // The click is the user gesture browsers require before the interviewer can play audio.
    driverRef.current = createDriver();
    setJoined(true);
  }

  async function submit(skip = false, override?: AnswerValue) {
    if (step.type !== "question" && step.type !== "followup") return;
    const a = override ?? answer;
    setBusy(true);
    setError(null);
    setSavedNote(null);
    driverRef.current?.prepare(); // warm up the video connection while the answer saves
    try {
      const res = await fetch(`/api/sessions/${state.session_id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question_id: step.question_id,
          phase: step.type === "question" ? "base" : "followup",
          skip,
          response_text: a.text,
          response_source: a.source,
          transcript_raw: a.transcript_raw,
          audio_id: a.audio_id,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.saved) throw new Error(data.error ?? "Your answer was not saved.");
      setState(data.state);
      setAnswer(emptyAnswer);
      setSavedNote(skip ? "Skipped." : "Answer saved.");
    } catch (err) {
      setError(`${err instanceof Error ? err.message : String(err)} Your text is still in the box; please try again.`);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    driverRef.current?.destroy();
    driverRef.current = null;
    setFinishing(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${state.session_id}/complete`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && data.status !== "evaluation_failed") throw new Error(data.error ?? "Could not finish the interview.");
      router.push(`/interview/${state.session_id}/results`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFinishing(false);
    }
  }

  function toggleMute() {
    driverRef.current?.setMuted(!muted);
    setMuted(!muted);
  }

  const answeredPct = Math.round((state.answered / state.total_questions) * 100);
  const mins = left !== null ? `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}` : null;
  const statusText: Record<AvatarState, string> = {
    idle: "Ready",
    connecting: "Joining…",
    speaking: "Speaking",
    listening: "Listening",
    error: "Reconnecting…",
  };
  const initials = avatar.interviewerName.slice(0, 1).toUpperCase();

  if (finishing) {
    return (
      <div className="card center" style={{ padding: 48 }}>
        <div className="spinner" style={{ margin: "0 auto 16px" }} />
        <h2>Evaluating your interview…</h2>
        <p className="muted">Each answer is scored against its rubric. This usually takes under a minute.</p>
      </div>
    );
  }

  const header = (
    <div className="spread">
      <div>
        <h1 style={{ marginBottom: 4 }}>{state.role}</h1>
        <span className="muted">{levelLabel} · mock interview</span>
      </div>
      <div className="row">
        {mins && (
          <span className={`chip ${left! < 5 * 60000 ? "" : "brand"}`} aria-live="polite">
            ⏱ {mins} left
          </span>
        )}
        <span className="chip">
          {Math.min(state.answered + (step.type === "finished" ? 0 : 1), state.total_questions)} of {state.total_questions}
        </span>
      </div>
    </div>
  );

  // ---- Lobby (pre-join) ---------------------------------------------------
  if (!joined) {
    return (
      <div className="stack">
        {header}
        <div className="card">
          <h2>Ready to join your interview?</h2>
          <div className="lobby">
            <div className="call-stage lobby-stage">
              <div className="interviewer-tile">
                {videoMode && avatar.idleVideoUrl ? (
                  <video className="idle-video" src={avatar.idleVideoUrl} poster={avatar.posterUrl ?? undefined} autoPlay loop muted playsInline aria-hidden />
                ) : (
                  <div className="avatar-placeholder">{initials}</div>
                )}
                <span className="tile-label">
                  {avatar.interviewerName} · AI interviewer
                </span>
              </div>
            </div>
            <div>
              <SelfView stream={camera.stream} />
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn secondary small" onClick={camera.toggle}>
                  {camera.stream ? "Turn camera off" : "Turn camera on"}
                </button>
                {!camera.stream && <span className="chip brand">Recommended</span>}
              </div>
              <p className="hint">
                Turning your camera on is optional but recommended for the best experience: it helps you practice eye contact and presence, like
                a real video interview. Your video is only shown to you. It is never recorded, uploaded or scored.
              </p>
              {camera.error && <p className="alert small">{camera.error}</p>}
              {voice && (
                <div style={{ marginTop: 14 }}>
                  <MicSetup deviceId={micId} onDeviceChange={setMicId} onReady={() => setMicReady(true)} />
                  <SpeechCheck support={speechSupport} />
                </div>
              )}
            </div>
          </div>
          <ul className="small muted" style={{ marginTop: 14 }}>
            <li>
              {avatar.interviewerName} will ask each question out loud{videoMode ? " on video" : ""}; the question also appears as a caption.
            </li>
            <li>{voice
                ? "Speak your answer after the interviewer finishes: listening starts automatically and your answer is submitted when you pause. Check your microphone above first."
                : "Type each answer, then submit it."}</li>
            <li>Use headphones if you can, and make sure your sound is on.</li>
          </ul>
          <button className="btn" onClick={join} style={{ marginTop: 6 }}>
            Join interview
          </button>
        </div>
      </div>
    );
  }

  // ---- Call --------------------------------------------------------------
  const live = videoMode && videoLive && (!freezeFrame || !!avatar.idleVideoUrl);
  return (
    <div className="stack">
      {header}
      <div className="progress" aria-hidden>
        <span style={{ width: `${answeredPct}%` }} />
      </div>
      {notice && (
        <p className="alert small" role="status">
          {notice}
        </p>
      )}

      <div className="call-stage">
        <div className={`interviewer-tile ${avatarState === "speaking" ? "is-speaking" : ""}`}>
          {/* Anam's natural idle loop plays whenever the (billed) live stream is disconnected. */}
          {videoMode && avatar.idleVideoUrl && (
            <video className="idle-video" src={avatar.idleVideoUrl} poster={avatar.posterUrl ?? undefined} autoPlay loop muted playsInline aria-hidden />
          )}
          {videoMode && <video id={VIDEO_ID} autoPlay playsInline className={`live-video ${live ? "" : "hidden-video"}`} />}
          {videoMode && !avatar.idleVideoUrl && freezeFrame && <img src={freezeFrame} alt="" className="freeze-frame" />}
          {(!videoMode || (!live && !freezeFrame && !avatar.idleVideoUrl)) && (
            <div className="avatar-placeholder">
              {initials}
              {avatarState === "speaking" && !videoMode && (
                <span className="voice-bars" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </div>
          )}
          <span className={`status-badge ${avatarState}`}>
            {avatarState === "connecting" && <span className="dot" />}
            {statusText[avatarState]}
          </span>
          <span className="tile-label">
            {avatar.interviewerName} · AI interviewer{!videoMode ? " (voice)" : ""}
          </span>
          <SelfView stream={camera.stream} compact />
        </div>
        {lastLine && (
          <div className="captions" aria-live="polite">
            {lastLine}
          </div>
        )}
        <div className="call-controls">
          <button className="ctl" onClick={camera.toggle} aria-pressed={!!camera.stream}>
            {camera.stream ? "📷 Camera on" : "📷 Camera off"}
          </button>
          <button className="ctl" onClick={toggleMute} aria-pressed={muted}>
            {muted ? "🔇 Interviewer muted" : "🔊 Interviewer sound"}
          </button>
          {voice && (
            <>
              <button className={`ctl ${micOn ? "" : "off"}`} onClick={() => setMicOn(!micOn)} aria-pressed={micOn}>
                {micOn ? "🎙 Mic on" : "🎙 Mic off"}
              </button>
              <button className="ctl" onClick={() => setMicPanel(!micPanel)} aria-expanded={micPanel}>
                ⚙ Microphone
              </button>
            </>
          )}
          <button className="ctl" onClick={() => lastLine && void say(lastLine)} disabled={speaking || !lastLine}>
            ↻ Repeat
          </button>
          <button
            className="ctl danger"
            onClick={() => confirm("End the interview now? Unanswered questions will score 0.") && finish()}
            disabled={busy}
          >
            End interview
          </button>
        </div>
        {voice && micPanel && (
          <div className="mic-panel">
            <MicSetup deviceId={micId} onDeviceChange={setMicId} />
          </div>
        )}
      </div>

      {savedNote && (
        <p className="small status-good" role="status">
          ✓ {savedNote}
        </p>
      )}

      {(step.type === "question" || step.type === "followup") && !timeUp && (
        <div className="card">
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="chip brand">{categoryLabels[step.category]}</span>
            <span className="muted small">Question {step.position}</span>
          </div>
          <p className="question-text">{step.question_text}</p>

          {step.type === "followup" && (
            <>
              <details style={{ marginBottom: 12 }}>
                <summary className="muted small" style={{ cursor: "pointer" }}>
                  Your answer (saved)
                </summary>
                <blockquote className="response">{step.response_text}</blockquote>
              </details>
              <div className="followup" style={{ marginBottom: 14 }}>
                <strong>Follow-up:</strong> {step.followup_text}
              </div>
            </>
          )}

          <AnswerInput
            key={`${step.question_id}-${step.type}`}
            sessionId={state.session_id}
            voice={voice}
            value={answer}
            onChange={setAnswer}
            onBusyChange={onBusyChange}
            disabled={busy}
            recordingBlocked={speaking}
            // Listening pauses while the interviewer talks (incl. Repeat) so its voice isn't transcribed.
            micMuted={!micOn || speaking}
            micDeviceId={micId}
            label={step.type === "followup" ? "Your follow-up answer" : "Your answer"}
            handsFree={voice && handsFree}
            autoStart={avatarState === "listening"}
            onAutoSubmit={(v) => void submit(false, v)}
          />
          {voice && (
            <label className="check small" style={{ marginTop: 6 }}>
              <input type="checkbox" checked={handsFree} onChange={(e) => setHandsFree(e.target.checked)} />
              <span>Hands-free: start listening when {avatar.interviewerName} finishes, and submit automatically when I stop talking</span>
            </label>
          )}
          {voice && speaking && (
            <p className="hint">
              {handsFree ? `Listening starts automatically when ${avatar.interviewerName} finishes speaking.` : `You can start recording when ${avatar.interviewerName} finishes speaking.`}
            </p>
          )}
          {step.category === "behavioral" && step.type === "question" && (
            <p className="hint">Tip: describe the Situation, your Task, the Actions you personally took, and the Result.</p>
          )}
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn" onClick={() => submit(false)} disabled={busy || inputBusy || !answer.text.trim()}>
              {busy ? "Saving…" : step.type === "followup" ? "Submit follow-up" : "Submit answer"}
            </button>
            <button className="btn ghost" onClick={() => submit(true)} disabled={busy || inputBusy}>
              {step.type === "followup" ? "Skip follow-up" : "Skip question"}
            </button>
          </div>
        </div>
      )}

      {(step.type === "finished" || timeUp) && (
        <div className="card center" style={{ padding: 40 }}>
          <h2>{timeUp && step.type !== "finished" ? "Time is up" : "That's the end of the interview"}</h2>
          <p className="muted">
            {state.answered} of {state.total_questions} questions answered. Your responses are saved. Get your scores, coaching and suggested
            answer outlines.
          </p>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          <button className="btn" onClick={finish}>
            Finish &amp; get feedback
          </button>
        </div>
      )}
    </div>
  );
}
