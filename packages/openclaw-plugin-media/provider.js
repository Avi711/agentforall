// The provider itself, free of any `openclaw` import so the whole request path stays testable.
import {
  buildTranscriptionBody,
  isTruncated,
  normalizeChatBaseUrl,
  readGatewayError,
  readModel,
  readTranscript,
  resolveAudioFormat,
} from "./transcribe.js";

export const PLUGIN_ID = "agentforall-media";
export const PROVIDER_ID = PLUGIN_ID;

// Only applies when OpenClaw sends no timeout of its own; the config renders one (90s).
const DEFAULT_TIMEOUT_MS = 90_000;
// AbortSignal.timeout refuses anything else, and a RangeError here would read as a gateway fault.
const MAX_TIMEOUT_MS = 2_147_483_647;
// What OpenClaw puts in `apiKey` when the provider resolved no key of its own.
const NO_AUTH_MARKER = "custom-local";
const FAILED = "Audio transcription failed";
// Headers this request owns, plus the hop-by-hop ones a stale config value would corrupt.
const RESERVED_HEADERS = new Set(["authorization", "content-type", "content-length", "host", "connection"]);

// OpenClaw registers a config provider (our LiteLLM entry) for image alone, so audio needs a
// plugin-backed provider. This one transcribes with the model the bot already replies with.
export function createMediaUnderstandingProvider({ logger } = {}) {
  return {
    id: PROVIDER_ID,
    capabilities: ["audio"],
    // No autoPriority on purpose: auto-detection only considers providers that declare one, so
    // this provider runs where the orchestrator named it and never as a surprise fallback.
    transcribeAudio: (params) => transcribeAudio(params, logger),
  };
}

export async function transcribeAudio(params, logger) {
  try {
    return await runTranscription(params, logger);
  } catch (err) {
    // A failed transcription is silent for the user — the voice note simply goes unanswered — so
    // it must leave a trace even though OpenClaw also logs the throw.
    warn(logger, errorText(err));
    throw err;
  }
}

async function runTranscription(params, logger) {
  const baseUrl =
    normalizeChatBaseUrl(params.baseUrl) ?? normalizeChatBaseUrl(process.env.AGENTFORALL_MEDIA_BASE_URL);
  if (!baseUrl) throw new Error(`${FAILED}: no usable gateway URL configured`);

  const apiKey = resolveApiKey(params);
  if (!apiKey) throw new Error(`${FAILED}: no API key available`);

  const model = typeof params.model === "string" ? params.model.trim() : "";
  if (!model) throw new Error(`${FAILED}: no model configured for the audio entry`);

  const format = resolveAudioFormat({ fileName: params.fileName, mime: params.mime });
  if (!format) {
    throw new Error(`${FAILED}: unsupported audio format (${params.mime || params.fileName || "unknown"})`);
  }

  const audio = toBuffer(params.buffer);
  if (!audio) throw new Error(`${FAILED}: unsupported attachment type`);
  if (!audio.byteLength) throw new Error(`${FAILED}: the attachment was empty`);

  const body = buildTranscriptionBody({
    model,
    base64: audio.toString("base64"),
    format,
    prompt: params.prompt,
    language: params.language,
  });

  const fetchFn = params.fetchFn ?? fetch;
  let response;
  try {
    response = await fetchFn(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        ...sanitizeHeaders(params.headers),
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: requestSignal(params),
    });
  } catch (err) {
    const reason = err?.name === "TimeoutError" ? "the gateway timed out" : errorText(err);
    throw new Error(`${FAILED}: ${reason}`, { cause: err });
  }

  if (!response.ok) {
    // 401/403 bodies are the ones that echo credentials back, and the status already says enough.
    const detail = response.status === 401 || response.status === 403 ? "" : await readErrorBody(response, apiKey);
    throw new Error(`${FAILED}: the gateway returned ${response.status}${detail ? ` — ${detail}` : ""}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    throw new Error(`${FAILED}: the response was not JSON (${errorText(err)})`, { cause: err });
  }

  // LiteLLM can report a refusal or a spent budget in a 200 body.
  const gatewayError = readGatewayError(payload);
  if (gatewayError) throw new Error(`${FAILED}: ${redactKeys(gatewayError, apiKey).slice(0, 300)}`);

  let text;
  try {
    text = readTranscript(payload);
  } catch (err) {
    throw new Error(`${FAILED}: ${errorText(err)}`, { cause: err });
  }
  if (isTruncated(payload)) warn(logger, "the model cut the transcript short (finish_reason=length)");
  // Empty is a valid answer (silence, or noise the model would not transcribe), but it is also
  // what a flaky completion looks like, so it never passes unnoticed.
  if (!text) warn(logger, `the model returned an empty transcript for ${params.fileName ?? "the attachment"}`);
  return { text, model: readModel(payload, model) };
}

// OpenClaw resolves auth from the provider block; ours has none, so the container's own variable
// is the working path. Its name is fixed here on purpose — the model client's key variable is
// derived from the provider id, which would change under us.
function resolveApiKey(params) {
  const candidates = [params.auth?.kind === "api-key" ? params.auth.apiKey : undefined, params.apiKey, process.env.AGENTFORALL_MEDIA_API_KEY];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed && trimmed !== NO_AUTH_MARKER) return trimmed;
  }
  return null;
}

// The host cancels a transcription it no longer needs (session reset, shutdown); its signal joins ours.
function requestSignal(params) {
  const timeout = AbortSignal.timeout(resolveTimeoutMs(params.timeoutMs));
  return params.signal ? AbortSignal.any([timeout, params.signal]) : timeout;
}

export function resolveTimeoutMs(raw) {
  return Number.isInteger(raw) && raw > 0 && raw <= MAX_TIMEOUT_MS ? raw : DEFAULT_TIMEOUT_MS;
}

// Views are wrapped, not copied: a 20 MB note is already base64-expanded once further down.
export function toBuffer(buffer) {
  if (Buffer.isBuffer(buffer)) return buffer;
  if (ArrayBuffer.isView(buffer)) return Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  // Cross-realm buffers fail instanceof, so the duck test is the reliable one.
  if (buffer && typeof buffer === "object" && typeof buffer.byteLength === "number" && !("length" in buffer)) {
    try {
      return Buffer.from(buffer);
    } catch {
      // Not an ArrayBuffer after all; reported as an unsupported attachment by the caller.
      return null;
    }
  }
  return null;
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const entries = Array.isArray(headers)
    ? headers
    : typeof headers.entries === "function"
      ? [...headers.entries()]
      : Object.entries(headers);
  const out = {};
  for (const [key, value] of entries) {
    if (typeof key !== "string" || RESERVED_HEADERS.has(key.toLowerCase())) continue;
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

async function readErrorBody(response, apiKey) {
  try {
    return redactKeys(await response.text(), apiKey).slice(0, 300);
  } catch {
    // Best-effort detail: a body we cannot read must not replace the status we already have.
    return "";
  }
}

// Gateways echo the received key in some auth errors, and this text lands in a log.
export function redactKeys(text, apiKey) {
  const withoutOurs = apiKey ? text.split(apiKey).join("sk-***") : text;
  return withoutOurs.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***");
}

// A logger that throws must not replace the failure the caller is about to see.
function warn(logger, message) {
  try {
    const line = `[${PLUGIN_ID}] ${message}`;
    if (typeof logger?.warn === "function") logger.warn(line);
    else console.warn(line);
  } catch {
    // Nothing left to report it to.
  }
}

function errorText(err) {
  return err instanceof Error ? err.message : String(err);
}
