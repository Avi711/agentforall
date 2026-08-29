import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrompt,
  buildTranscriptionBody,
  isTruncated,
  normalizeChatBaseUrl,
  readGatewayError,
  readModel,
  readTranscript,
  resolveAudioFormat,
} from "./transcribe.js";

test("resolveAudioFormat maps the mime types the channels send", () => {
  assert.equal(resolveAudioFormat({ mime: "audio/ogg; codecs=opus", fileName: "voice" }), "ogg");
  assert.equal(resolveAudioFormat({ mime: "audio/mpeg", fileName: "clip" }), "mp3");
  assert.equal(resolveAudioFormat({ mime: "audio/x-wav", fileName: "clip" }), "wav");
  assert.equal(resolveAudioFormat({ mime: "video/mp4", fileName: "clip" }), "m4a");
});

test("resolveAudioFormat falls back to the file extension", () => {
  assert.equal(resolveAudioFormat({ mime: "application/octet-stream", fileName: "note.OGG" }), "ogg");
  assert.equal(resolveAudioFormat({ fileName: "note.m4a" }), "m4a");
});

test("resolveAudioFormat rejects what Gemini cannot read inline", () => {
  assert.equal(resolveAudioFormat({ mime: "audio/amr", fileName: "note.amr" }), null);
  assert.equal(resolveAudioFormat({ fileName: "note" }), null);
  // A name that is only an extension-looking word has no extension at all.
  assert.equal(resolveAudioFormat({ fileName: "mp3" }), null);
  assert.equal(resolveAudioFormat({}), null);
  assert.equal(resolveAudioFormat(), null);
});

test("resolveAudioFormat maps the Apple voice-note mime", () => {
  assert.equal(resolveAudioFormat({ mime: "audio/x-m4a", fileName: "voice" }), "m4a");
});

test("normalizeChatBaseUrl keeps an OpenAI-compatible root and adds one when missing", () => {
  assert.equal(normalizeChatBaseUrl("https://litellm.example/v1/"), "https://litellm.example/v1");
  assert.equal(normalizeChatBaseUrl("https://litellm.example"), "https://litellm.example/v1");
  assert.equal(normalizeChatBaseUrl("https://gw.example:4000/api"), "https://gw.example:4000/api/v1");
  assert.equal(normalizeChatBaseUrl("https://gw.example/openai/v2"), "https://gw.example/openai/v2");
  assert.equal(normalizeChatBaseUrl("https://gw.example/v1beta"), "https://gw.example/v1beta");
  // A query or fragment cannot carry a path suffix, so it is dropped rather than mangled.
  assert.equal(normalizeChatBaseUrl("https://gw.example/v1?x=1#f"), "https://gw.example/v1");
});

test("normalizeChatBaseUrl refuses what is not an http(s) URL", () => {
  assert.equal(normalizeChatBaseUrl("  "), null);
  assert.equal(normalizeChatBaseUrl(undefined), null);
  assert.equal(normalizeChatBaseUrl("not a url"), null);
  assert.equal(normalizeChatBaseUrl("file:///etc/passwd"), null);
});

test("readGatewayError surfaces a 200-with-error body", () => {
  assert.equal(readGatewayError({ error: { message: "budget exceeded" } }), "budget exceeded");
  assert.equal(readGatewayError({ error: "plain string" }), "plain string");
  assert.match(readGatewayError({ error: {} }), /reported an error/);
  assert.equal(readGatewayError({ choices: [] }), null);
  assert.equal(readGatewayError(null), null);
});

test("isTruncated only fires on the model's own ceiling", () => {
  assert.equal(isTruncated({ choices: [{ finish_reason: "length" }] }), true);
  assert.equal(isTruncated({ choices: [{ finish_reason: "stop" }] }), false);
  assert.equal(isTruncated({}), false);
});

test("buildPrompt keeps OpenClaw's prompt and names the language", () => {
  assert.equal(buildPrompt({ prompt: "Transcribe.", language: "he" }), "Transcribe. The audio is in he.");
  assert.match(buildPrompt({}), /^Transcribe this audio verbatim/);
  assert.match(buildPrompt({ prompt: "   " }), /^Transcribe this audio verbatim/);
});

test("buildTranscriptionBody sends one user turn with the audio inline", () => {
  const body = buildTranscriptionBody({
    model: "gemini-agentforall",
    base64: "AAAA",
    format: "ogg",
    prompt: "Transcribe.",
  });
  assert.equal(body.model, "gemini-agentforall");
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, "user");
  assert.deepEqual(body.messages[0].content[1], {
    type: "input_audio",
    input_audio: { data: "AAAA", format: "ogg" },
  });
});

test("readTranscript reads a plain string content", () => {
  assert.equal(readTranscript({ choices: [{ message: { content: " שלום " } }] }), "שלום");
});

test("readTranscript reads the content-parts shape", () => {
  const payload = { choices: [{ message: { content: [{ type: "text", text: "hi " }, { type: "text", text: "there" }] } }] };
  assert.equal(readTranscript(payload), "hi there");
});

test("readTranscript keeps an empty transcript for silence, in either shape", () => {
  assert.equal(readTranscript({ choices: [{ message: { content: "" } }] }), "");
  assert.equal(readTranscript({ choices: [{ message: { content: [] } }] }), "");
});

test("readTranscript keeps reasoning and refusal parts out of the transcript", () => {
  const payload = {
    choices: [
      {
        message: {
          content: [
            { type: "thinking", text: "the caller said" },
            { type: "text", text: "שלום" },
            { type: "refusal", text: "no" },
          ],
        },
      },
    ],
  };
  assert.equal(readTranscript(payload), "שלום");
});

test("readTranscript refuses a filtered answer instead of passing off silence", () => {
  const payload = { choices: [{ finish_reason: "content_filter", message: { content: "" } }] };
  assert.throws(() => readTranscript(payload), /refused to transcribe/);
});

// Filtering non-text parts must not turn a refusal into an empty, successful transcript.
test("readTranscript refuses a response whose parts hold no transcript", () => {
  const payload = { choices: [{ message: { content: [{ type: "refusal", text: "I won't" }] } }] };
  assert.throws(() => readTranscript(payload), /no transcript parts/);
});

test("readTranscript surfaces the top-level refusal field", () => {
  const payload = { choices: [{ message: { refusal: "not allowed", content: null } }] };
  assert.throws(() => readTranscript(payload), /the model refused: not allowed/);
});

test("readTranscript refuses a response it cannot read", () => {
  assert.throws(() => readTranscript(null), /not an object/);
  assert.throws(() => readTranscript([]), /not an object/);
  assert.throws(() => readTranscript({}), /no message content/);
  assert.throws(() => readTranscript({ choices: [{ message: {} }] }), /no message content/);
});

test("readModel prefers the reported model and falls back to the requested one", () => {
  assert.equal(readModel({ model: "gemini-agentforall" }, "fallback"), "gemini-agentforall");
  assert.equal(readModel({}, "fallback"), "fallback");
  assert.equal(readModel({ model: "  " }, "fallback"), "fallback");
});
