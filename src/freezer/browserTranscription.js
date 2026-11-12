export const SPEECH_LANGUAGE = "nb-NO";

export function browserSpeechAvailable() {
  return typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// The browser chooses its recognition engine. This API does not guarantee on-device processing.
export function startBrowserTranscription({ onTranscript, onError, onEnd }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) throw new Error("Voice recognition is unavailable in this browser. Use the text field instead.");
  const recognition = new Recognition();
  recognition.lang = SPEECH_LANGUAGE;
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    const text = Array.from(event.results).map((result) => result[0]?.transcript || "").join(" ").trim();
    if (text) onTranscript(text);
    else onError("No words were recognized. Try again or type the correction.");
  };
  recognition.onerror = (event) => onError(`Voice recognition: ${event.error}. Try again or type the correction.`);
  recognition.onend = onEnd;
  recognition.start();
  return {
    stop: () => recognition.stop(),
    cancel: () => recognition.abort(),
  };
}
