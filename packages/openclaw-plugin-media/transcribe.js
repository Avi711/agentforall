// Pure request/response shaping, kept apart from the plugin entry so it can be tested without OpenClaw.

// Formats Gemini reads inline. Anything else is refused before a paid request is spent.
const SUPPORTED_FORMATS = new Map([
  ["ogg", "ogg"],
  ["oga", "ogg"],
  ["opus", "ogg"],
  ["mp3", "mp3"],
  ["mpeg", "mp3"],
  ["mpga", "mp3"],
  ["m4a", "m4a"],
  ["x-m4a", "m4a"],
  ["mp4", "m4a"],
  ["aac", "aac"],
  ["wav", "wav"],
  ["x-wav", "wav"],
  ["wave", "wav"],
  ["webm", "webm"],
  ["flac", "flac"],
  ["x-flac", "flac"],
]);

const DEFAULT_PROMPT = "Transcribe this audio verbatim. Reply with the transcript only.";
const VERSION_SEGMENT = /^v\d+[a-z]*$/i;

export function resolveAudioFormat({ fileName, mime } = {}) {
  const type = typeof mime === "string" ? mime.split(";")[0].trim().toLowerCase() : "";
  if (type.startsWith("audio/") || type.startsWith("video/")) {
    const format = SUPPORTED_FORMATS.get(type.slice(type.indexOf("/") + 1));
    if (format) return format;
  }
  if (typeof fileName !== "string") return null;
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  return SUPPORTED_FORMATS.get(fileName.slice(dot + 1).toLowerCase()) ?? null;
}

// The transcript call posts to `${baseUrl}/chat/completions`, so the OpenAI-compatible `/v1` root
// is appended when the caller passed the gateway root. Mirrors the credit plugin, which strips it.
export function normalizeChatBaseUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // A query or fragment on a base URL is not something we can append a path to meaningfully.
  url.search = "";
  url.hash = "";
  const path = url.pathname.replace(/\/+$/, "");
  const last = path.slice(path.lastIndexOf("/") + 1);
  url.pathname = VERSION_SEGMENT.test(last) ? path : `${path}/v1`;
  return url.toString().replace(/\/+$/, "");
}

export function buildPrompt({ prompt, language } = {}) {
  const base = typeof prompt === "string" && prompt.trim() ? prompt.trim() : DEFAULT_PROMPT;
  const lang = typeof language === "string" ? language.trim() : "";
  return lang ? `${base} The audio is in ${lang}.` : base;
}

export function buildTranscriptionBody({ model, base64, format, prompt, language }) {
  return {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: buildPrompt({ prompt, language }) },
          { type: "input_audio", input_audio: { data: base64, format } },
        ],
      },
    ],
  };
}

// A gateway can report a refusal or a spent budget in a 200 body; that reason belongs in the log
// instead of the "no message content" it would otherwise become.
export function readGatewayError(payload) {
  const error = payload && typeof payload === "object" ? payload.error : undefined;
  if (!error) return null;
  const message = typeof error === "object" && error !== null ? error.message : error;
  return typeof message === "string" && message.trim() ? message.trim() : "the gateway reported an error";
}

// A transcript of "" is a legitimate answer for silence, in either content shape — but a response
// that carried parts and none of them were text is a refusal, not silence.
export function readTranscript(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("response was not an object");
  }
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
  if (!choice || typeof choice !== "object") throw new Error("response had no message content");
  if (choice.finish_reason === "content_filter") throw new Error("the model refused to transcribe the audio");

  const message = choice.message;
  const refusal = message && typeof message === "object" ? message.refusal : undefined;
  if (typeof refusal === "string" && refusal.trim()) throw new Error(`the model refused: ${refusal.trim()}`);

  const content = message && typeof message === "object" ? message.content : undefined;
  if (typeof content === "string") return content.trim();
  // A finished answer with no content is the model saying it heard nothing to transcribe. That is
  // an empty transcript, not a failure: failing here would leave the voice note unanswered.
  if (content === null || content === undefined) {
    if (message && typeof message === "object" && choice.finish_reason === "stop") return "";
    throw new Error("response had no message content");
  }
  if (Array.isArray(content)) {
    // Reasoning and refusal parts also carry `text`, so only the ones typed as text are transcript.
    const parts = content.filter(
      (part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string",
    );
    if (content.length > 0 && parts.length === 0) throw new Error("response carried no transcript parts");
    return parts.map((part) => part.text).join("").trim();
  }
  throw new Error("response had no message content");
}

// Nothing caps the answer, so this only fires if the model hit its own ceiling — the transcript is
// then real but cut short, which the caller logs rather than passes off as complete.
export function isTruncated(payload) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : undefined;
  return choice?.finish_reason === "length";
}

export function readModel(payload, fallback) {
  const model = payload && typeof payload === "object" ? payload.model : undefined;
  return typeof model === "string" && model.trim() ? model.trim() : fallback;
}
