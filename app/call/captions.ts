/**
 * Live captions through the browser's speech recognition (the Web Speech
 * API). Chrome, Edge, and Safari support it; Firefox doesn't.
 */

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function speechRecognition(): SpeechRecognitionConstructor | undefined {
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

export interface Transcriber {
  stop(): void;
}

/**
 * Transcribes the microphone until stopped. Returns null when the browser
 * can't transcribe; `onUnavailable` fires if it stops being able to (for
 * example, when permission is refused).
 */
export function startTranscriber({
  onText,
  onUnavailable,
}: {
  onText: (text: string) => void;
  onUnavailable: () => void;
}): Transcriber | null {
  const Recognition = speechRecognition();
  if (Recognition === undefined) return null;

  let active = true;
  let recognition: SpeechRecognitionLike | null = null;
  let restartDelay = 0;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;

  const listen = (): boolean => {
    const current = new Recognition();
    current.continuous = true;
    current.interimResults = true;
    current.lang = navigator.language;
    current.onresult = (event) => {
      restartDelay = 0;
      let text = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        text += event.results[index]?.[0]?.transcript ?? "";
      }
      if (text.trim() !== "") onText(text.trim());
    };
    current.onerror = ({ error }) => {
      if (error === "not-allowed" || error === "service-not-allowed") {
        active = false;
        onUnavailable();
      }
    };
    // Browsers stop listening after a pause or a network error. Keep going
    // until asked to stop, backing off if it keeps failing.
    current.onend = () => {
      if (!active) return;
      restartTimer = setTimeout(() => {
        if (active && !listen()) onUnavailable();
      }, restartDelay);
      restartDelay = Math.min(restartDelay * 2 + 250, 5000);
    };
    recognition = current;
    try {
      current.start();
      return true;
    } catch {
      active = false;
      return false;
    }
  };

  if (!listen()) return null;
  return {
    stop() {
      active = false;
      clearTimeout(restartTimer);
      recognition?.abort();
    },
  };
}
