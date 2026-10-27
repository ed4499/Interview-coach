"use client";

import { useEffect, useRef, useState } from "react";

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
  start(): void;
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
}

export default function AnswerInput({ sessionId, voice, value, onChange, onBusyChange, disabled, recordingBlocked, label = "Your answer" }: Props) {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [interim, setInterim] = useState("");
  const [audioStatus, setAudioStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [srSupported, setSrSupported] = useState(true);
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const live = useRef({ base: "", rawPrefix: "", finalText: "", active: false });
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => setSrSupported(!!speechRecognitionCtor()), []);
  useEffect(() => onBusyChange?.(recording || uploading), [recording, uploading, onBusyChange]);
  useEffect(
    () => () => {
      live.current.active = false;
      recognition.current?.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function startRecording() {
    setAudioStatus(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const rec = new MediaRecorder(media);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => upload(new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }));
      rec.start();
      recorder.current = rec;

      live.current = {
        base: valueRef.current.text ? valueRef.current.text.trimEnd() + " " : "",
        rawPrefix: valueRef.current.transcript_raw ?? "",
        finalText: "",
        active: true,
      };
      const Ctor = speechRecognitionCtor();
      if (Ctor) {
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
          const transcript = live.current.finalText.trim();
          onChange({
            ...valueRef.current,
            text: live.current.base + transcript,
            source: "audio_transcript",
            // Unedited speech-to-text output, kept alongside the (editable) submitted answer.
            transcript_raw: [live.current.rawPrefix, transcript].filter(Boolean).join(" "),
          });
        };
        // Browsers end recognition after silence; keep listening while recording.
        sr.onend = () => live.current.active && sr.start();
        sr.onerror = (e) => {
          if (e.error === "not-allowed" || e.error === "service-not-allowed") {
            live.current.active = false;
            setSrSupported(false);
          }
        };
        sr.start();
        recognition.current = sr;
      }
      setRecording(true);
    } catch {
      setAudioStatus({ ok: false, msg: "Microphone access was blocked. Allow microphone access in your browser, or type your answer." });
    }
  }

  function stopRecording() {
    live.current.active = false;
    recognition.current?.stop();
    recognition.current = null;
    recorder.current?.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
    setRecording(false);
    setInterim("");
  }

  async function upload(blob: Blob) {
    if (!blob.size) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("audio", blob, "answer.webm");
      const res = await fetch(`/api/sessions/${sessionId}/audio`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.saved) throw new Error(data.error ?? "Upload failed");
      onChange({ ...valueRef.current, audio_id: data.audio_id });
      setAudioStatus({ ok: true, msg: "Recording saved." });
    } catch (err) {
      setAudioStatus({ ok: false, msg: `The recording was NOT saved (${err instanceof Error ? err.message : "error"}). Your transcript text is still here; record again or submit the text.` });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label htmlFor="answer">{label}</label>
      {voice && (
        <div className="row" style={{ marginBottom: 10 }}>
          {!recording ? (
            <button type="button" className="btn secondary" onClick={startRecording} disabled={disabled || uploading || recordingBlocked}>
              🎙 {value.audio_id ? "Record again" : "Start recording"}
            </button>
          ) : (
            <button type="button" className="btn danger" onClick={stopRecording}>
              <span className="rec-dot" aria-hidden /> Stop recording
            </button>
          )}
          {uploading && <span className="muted small">Saving recording…</span>}
          {audioStatus && (
            <span className={`small ${audioStatus.ok ? "status-good" : "status-bad"}`} role="status">
              {audioStatus.msg}
            </span>
          )}
        </div>
      )}
      {voice && !srSupported && (
        <p className="alert small">
          Live transcription isn&apos;t available in this browser (it works best in Chrome or Edge). Your recording is still saved; please type
          your answer below.
        </p>
      )}
      <textarea
        id="answer"
        value={value.text}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
        disabled={disabled || recording}
        placeholder={voice ? "Your transcript appears here while you speak. You can correct it before submitting." : "Type your answer…"}
        maxLength={20000}
      />
      {recording && interim && <p className="muted small">… {interim}</p>}
      <p className="hint">{value.text.trim() ? value.text.trim().split(/\s+/).length : 0} words</p>
    </div>
  );
}
