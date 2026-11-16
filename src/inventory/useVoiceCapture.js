import { useEffect, useRef, useState } from "react";
import { startBrowserTranscription } from "../freezer/browserTranscription";

export default function useVoiceCapture() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const attemptRef = useRef(0);

  useEffect(() => () => recognitionRef.current?.cancel(), []);

  const begin = () => {
    setOpen(true);
    setText("");
    setError("");
    recognitionRef.current?.cancel();
    const attempt = ++attemptRef.current;
    try {
      recognitionRef.current = startBrowserTranscription({
        onTranscript: (value) => { if (attempt === attemptRef.current) setText(value); },
        onError: (message) => { if (attempt === attemptRef.current) setError(message); },
        onEnd: () => { if (attempt === attemptRef.current) setListening(false); },
      });
      setListening(true);
    } catch (captureError) {
      setError(captureError.message || "Could not start voice capture. Type the update instead.");
      setListening(false);
    }
  };

  const cancel = () => {
    attemptRef.current += 1;
    recognitionRef.current?.cancel();
    recognitionRef.current = null;
    setListening(false);
    setOpen(false);
  };

  return { open, text, error, listening, begin, retry: begin, stop: () => recognitionRef.current?.stop(), cancel };
}
