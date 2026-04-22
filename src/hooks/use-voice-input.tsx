import { useCallback, useEffect, useRef, useState } from "react";

// Minimal SpeechRecognition typings (TS DOM lib doesn't include them everywhere)
type SRResult = { isFinal: boolean; 0: { transcript: string } };
type SREvent = { resultIndex: number; results: ArrayLike<SRResult> };
type SRErrorEvent = { error: string };

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

function getSpeechRecognitionCtor():
  | (new () => SpeechRecognitionLike)
  | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface UseVoiceInputOptions {
  /** Called whenever transcript changes (interim or final). */
  onTranscript?: (text: string, isFinal: boolean) => void;
  /** Called once with the final transcript when the user stops. */
  onFinal?: (text: string) => void;
  /** Called on recognition error with a human-readable message. */
  onError?: (message: string) => void;
  /** BCP-47 lang tag, defaults to browser locale. */
  lang?: string;
}

export function useVoiceInput(opts: UseVoiceInputOptions = {}) {
  const { onTranscript, onFinal, onError, lang } = opts;
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");

  useEffect(() => {
    setSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      onError?.("Voice input is not supported in this browser. Try Chrome, Edge, or Safari.");
      return;
    }
    if (recRef.current) {
      try { recRef.current.abort(); } catch { /* */ }
    }
    const rec = new Ctor();
    rec.lang = lang ?? (typeof navigator !== "undefined" ? navigator.language : "en-US");
    rec.continuous = true;
    rec.interimResults = true;
    finalRef.current = "";

    rec.onstart = () => setListening(true);
    rec.onend = () => {
      setListening(false);
      if (finalRef.current.trim()) onFinal?.(finalRef.current.trim());
    };
    rec.onerror = (e) => {
      setListening(false);
      const msg =
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "Microphone permission denied."
          : e.error === "no-speech"
          ? "No speech detected."
          : e.error === "audio-capture"
          ? "No microphone found."
          : `Voice input error: ${e.error}`;
      onError?.(msg);
    };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0].transcript;
        if (r.isFinal) finalRef.current += t;
        else interim += t;
      }
      const combined = (finalRef.current + interim).trim();
      onTranscript?.(combined, false);
    };

    try {
      rec.start();
      recRef.current = rec;
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Could not start voice input.");
    }
  }, [lang, onError, onFinal, onTranscript]);

  const stop = useCallback(() => {
    if (recRef.current) {
      try { recRef.current.stop(); } catch { /* */ }
    }
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(() => () => { try { recRef.current?.abort(); } catch { /* */ } }, []);

  return { supported, listening, start, stop, toggle };
}
