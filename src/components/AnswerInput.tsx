"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_HANDS_FREE, type HandsFreePhase, HandsFreeTimer } from "@/lib/handsFree";
import { SPEECH_LEVEL, levelMeter, openMic } from "./mic";

export interface AnswerValue {
  text: string;
  source: "text" | "audio_transcript";
  transcript_raw: string | null;
  audio_id: string | null;
}

export const emptyAnswer: AnswerValue = { text: "", source: "text", transcript_raw: null, audio_id: null };

// Minimal Web Speech API typing (not in lib.dom for all TS versions).
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  /** Chrome/Edge 135+: recognize a specific microphone track instead of the default device. */
  start(audioTrack?: MediaStreamTrack): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type SRCtor = new () => SpeechRecognitionLike;

function speechRecognitionCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Speech-recognition errors that won't fix themselves by restarting. */
const SR_FATAL: Record<string, string> = {
  "not-allowed": "Speech-to-text was blocked by the browser. Allow microphone access for this site, or type your answer.",
  "service-not-allowed": "Speech-to-text isn't allowed in this browser. Use Google Chrome or Microsoft Edge, or type your answer.",
  "audio-capture": "Speech-to-text couldn't use your microphone. Pick a different microphone, or type your answer.",
  network:
    "Your browser's speech-to-text service couldn't be reached. It works in Google Chrome and Microsoft Edge (Brave and some other browsers block it). Your recording is still saved; you can type your answer.",
};

interface Props {
  sessionId: string;
  voice: boolean;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
  /** Blocks starting a recording (e.g. while the interviewer is speaking, so its voice isn't transcribed). */
  recordingBlocked?: boolean;
  label?: string;
  /** Hands-free: start listening automatically and submit after the candidate stops talking. */
  handsFree?: boolean;
  /** With handsFree, start listening whenever this is true (unless the candidate stopped it). */
  autoStart?: boolean;
  onAutoSubmit?: (v: AnswerValue) => void;
  /** Microphone chosen in the mic picker (null = browser default). */
  micDeviceId?: string | null;
  /** Mic switched off in the call controls. */
  micMuted?: boolean;
}

export default function AnswerInput({
  sessionId,
  voice,
  value,
  onChange,
  onBusyChange,
  disabled,
  recordingBlocked,
  label = "Your answer",
  handsFree = false,
  autoStart = false,
  onAutoSubmit,
  micDeviceId = null,
  micMuted = false,
}: Props) {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [interim, setInterim] = useState("");
  const [audioStatus, setAudioStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [srProblem, setSrProblem] = useState<string | null>(null);
  const [srSupported, setSrSupported] = useState(true);
  const [level, setLevel] = useState(0);
  const [noWords, setNoWords] = useState(false);
  const [hfPhase, setHfPhase] = useState<HandsFreePhase>({ phase: "waiting" });
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const meter = useRef<ReturnType<typeof levelMeter> | null>(null);
  const live = useRef({ base: "", rawPrefix: "", finalText: "", active: false, srActive: false, lastWordsAt: 0, voicedMs: 0 });
  const valueRef = useRef(value);
  valueRef.current = value;
  const srEnded = useRef<(() => void) | null>(null);
  const uploadDone = useRef<Promise<void>>(Promise.resolve());
  const hf = useRef(new HandsFreeTimer(DEFAULT_HANDS_FREE));
  const manuallyStopped = useRef(false);
  const submitting = useRef(false);

  /** Updates the parent and our ref immediately, so an auto-submit right after sees the latest text. */
  function emit(v: AnswerValue) {
    valueRef.current = v;
    onChange(v);
  }

  useEffect(() => setSrSupported(!!speechRecognitionCtor()), []);
  useEffect(() => onBusyChange?.(recording || uploading), [recording, uploading, onBusyChange]);
  useEffect(
    () => () => {
      live.current.active = false;
      live.current.srActive = false;
      recognition.current?.stop();
      meter.current?.close();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  function startRecognition(track: MediaStreamTrack | undefined) {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    const sr = new Ctor();
    sr.continuous = true;
    sr.interimResults = true;
    sr.lang = "en-US";
    sr.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) live.current.finalText += r[0].transcript.trim() + " ";
        else interimText += r[0].transcript;
      }
      setInterim(interimText);
      setNoWords(false);
      live.current.lastWordsAt = Date.now();
      live.current.voicedMs = 0;
      hf.current.speech(Date.now());
      const transcript = live.current.finalText.trim();
      emit({
        ...valueRef.current,
        text: live.current.base + transcript,
        source: "audio_transcript",
        // Unedited speech-to-text output, kept alongside the (editable) submitted answer.
        transcript_raw: [live.current.rawPrefix, transcript].filter(Boolean).join(" "),
      });
    };
    const begin = () => {
      try {
        // Recognize the chosen microphone where supported (Chrome/Edge 135+); else the default mic.
        if (track && track.readyState === "live") sr.start(track);
        else sr.start();
      } catch {
        try {
          sr.start();
        } catch {}
      }
    };
    // Browsers end recognition after silence; keep listening while recording.
    sr.onend = () => {
      if (live.current.srActive) begin();
      else srEnded.current?.();
    };
    sr.onerror = (e) => {
      if (SR_FATAL[e.error]) {
        live.current.srActive = false;
        setSrProblem(SR_FATAL[e.error]);
      }
    };
    live.current.srActive = true;
    begin();
    recognition.current = sr;
  }

  async function startRecording() {
    if (recording || recordingBlocked || micMuted) return;
    setAudioStatus(null);
    setSrProblem(null);
    setNoWords(false);
    hf.current = new HandsFreeTimer(DEFAULT_HANDS_FREE);
    submitting.current = false;
    manuallyStopped.current = false;
    setHfPhase({ phase: "waiting" });
    try {
      const media = await openMic(micDeviceId);
      stream.current = media;
      const rec = new MediaRecorder(media);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        uploadDone.current = upload(new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }));
      };
      rec.start();
      recorder.current = rec;
      meter.current = levelMeter(media);

      live.current = {
        base: valueRef.current.text ? valueRef.current.text.trimEnd() + " " : "",
        rawPrefix: valueRef.current.transcript_raw ?? "",
        finalText: "",
        active: true,
        srActive: false,
        lastWordsAt: Date.now(),
        voicedMs: 0,
      };
      startRecognition(media.getAudioTracks()[0]);
      setRecording(true);
    } catch (err) {
      setAudioStatus({
        ok: false,
        msg:
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Microphone access is blocked. Allow the microphone for this site (lock icon in the address bar), or type your answer."
            : "Your microphone couldn't be opened. Pick a different microphone, or type your answer.",
      });
    }
  }

  /** Stops recording; resolves once final transcript results and the audio upload are done. */
  async function stopRecording(): Promise<void> {
    live.current.active = false;
    const hadRecognition = !!recognition.current && live.current.srActive;
    live.current.srActive = false;
    const finalResults = new Promise<void>((resolve) => {
      srEnded.current = resolve;
      setTimeout(resolve, 1500);
    });
    recognition.current?.stop();
    recognition.current = null;
    const rec = recorder.current;
    const stopped = new Promise<void>((resolve) => {
      if (!rec || rec.state === "inactive") return resolve();
      rec.addEventListener("stop", () => resolve(), { once: true });
    });
    rec?.stop();
    meter.current?.close();
    meter.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    setRecording(false);
    setInterim("");
    setLevel(0);
    await Promise.all([hadRecognition ? finalResults : Promise.resolve(), stopped]);
    await uploadDone.current;
  }

  async function finishHandsFree() {
    if (submitting.current) return;
    submitting.current = true;
    await stopRecording();
    if (valueRef.current.text.trim()) onAutoSubmit?.(valueRef.current);
    else submitting.current = false;
  }

  // Hands-free: open the mic automatically once the interviewer has finished speaking.
  useEffect(() => {
    if (!voice || !handsFree || !autoStart || recordingBlocked || disabled || micMuted || recording || manuallyStopped.current || submitting.current) return;
    if (!speechRecognitionCtor()) return;
    void startRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice, handsFree, autoStart, recordingBlocked, disabled, micMuted, recording]);

  // Mic switched off: stop listening without submitting.
  useEffect(() => {
    if (micMuted && recording) {
      hf.current.pause();
      void stopRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micMuted]);

  // While recording: level meter, "we hear you but get no words" check, hands-free timing.
  useEffect(() => {
    if (!recording) return;
    let last = Date.now();
    const t = setInterval(() => {
      const now = Date.now();
      const l = meter.current?.read() ?? 0;
      setLevel(l);
      if (l > SPEECH_LEVEL) live.current.voicedMs += now - last;
      last = now;
      // ~4 s of audible speech with no recognized words: speech-to-text isn't working.
      if (live.current.voicedMs > 4000 && now - live.current.lastWordsAt > 6000) setNoWords(true);
      if (handsFree) {
        const p = hf.current.state(now);
        setHfPhase(p);
        if (p.phase === "submit") void finishHandsFree();
      }
    }, 150);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, handsFree]);

  async function upload(blob: Blob) {
    if (!blob.size) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("audio", blob, "answer.webm");
      const res = await fetch(`/api/sessions/${sessionId}/audio`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.saved) throw new Error(data.error ?? "Upload failed");
      emit({ ...valueRef.current, audio_id: data.audio_id });
      setAudioStatus({ ok: true, msg: "Recording saved." });
    } catch (err) {
      setAudioStatus({ ok: false, msg: `The recording was NOT saved (${err instanceof Error ? err.message : "error"}). Your transcript text is still here; record again or submit the text.` });
    } finally {
      setUploading(false);
    }
  }

  const problem = srProblem ?? (noWords ? "We can hear your microphone, but no words are being transcribed. Try Google Chrome or Microsoft Edge, check the microphone choice, or type your answer." : null);

  return (
    <div>
      <label htmlFor="answer">{label}</label>
      {voice && (
        <div className="row" style={{ marginBottom: 10 }}>
          {!recording ? (
            <button type="button" className="btn secondary" onClick={startRecording} disabled={disabled || uploading || recordingBlocked || micMuted}>
              🎙 {micMuted ? "Mic is off" : value.audio_id ? "Record again" : handsFree ? "Start listening" : "Start recording"}
            </button>
          ) : (
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                manuallyStopped.current = true;
                hf.current.pause();
                void stopRecording();
              }}
            >
              <span className="rec-dot" aria-hidden /> {handsFree ? "Stop listening" : "Stop recording"}
            </button>
          )}
          {recording && (
            <span className="mic-meter inline" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
              <span style={{ width: `${Math.round(level * 100)}%` }} />
            </span>
          )}
          {uploading && <span className="muted small">Saving recording…</span>}
          {audioStatus && (
            <span className={`small ${audioStatus.ok ? "status-good" : "status-bad"}`} role="status">
              {audioStatus.msg}
            </span>
          )}
        </div>
      )}
      {voice && handsFree && recording && (
        <div className={`handsfree ${hfPhase.phase}`} role="status" aria-live="polite">
          {hfPhase.phase === "countdown" ? (
            <>
              <span>Submitting your answer in {Math.ceil(hfPhase.remainingMs / 1000)}… keep talking to continue.</span>
              <span className="row" style={{ gap: 6 }}>
                <button type="button" className="btn secondary small" onClick={() => hf.current.extend(Date.now())}>
                  Not done yet
                </button>
                <button type="button" className="btn small" onClick={() => void finishHandsFree()}>
                  Submit now
                </button>
              </span>
            </>
          ) : (
            <span>
              <span className="rec-dot" aria-hidden /> {hfPhase.phase === "speaking" ? "Listening…" : "Listening. Start your answer whenever you're ready."}{" "}
              <span className="muted">It submits automatically after you pause for a few seconds.</span>
            </span>
          )}
        </div>
      )}
      {voice && problem && (
        <p className="alert error small" role="alert">
          {problem}
        </p>
      )}
      {voice && !srSupported && (
        <p className="alert small">
          Live transcription isn&apos;t available in this browser (it works in Google Chrome and Microsoft Edge). Your recording is still saved;
          please type your answer below.
        </p>
      )}
      <textarea
        id="answer"
        value={value.text}
        onChange={(e) => emit({ ...value, text: e.target.value })}
        disabled={disabled || recording}
        placeholder={voice ? "Your transcript appears here while you speak. You can correct it before submitting." : "Type your answer…"}
        maxLength={20000}
      />
      {recording && interim && <p className="muted small">… {interim}</p>}
      <p className="hint">{value.text.trim() ? value.text.trim().split(/\s+/).length : 0} words</p>
    </div>
  );
}
