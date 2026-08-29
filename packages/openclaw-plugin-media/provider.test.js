import assert from "node:assert/strict";
import test from "node:test";
import {
  PLUGIN_ID,
  PROVIDER_ID,
  createMediaUnderstandingProvider,
  redactKeys,
  resolveTimeoutMs,
  toBuffer,
  transcribeAudio,
} from "./provider.js";

const KEY = "sk-tenant-key-123456789";
const BASE_URL = "https://litellm.example/v1";

function okResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

function transcriptResponse(text) {
  return okResponse({ model: "gemini-agentforall", choices: [{ message: { content: text } }] });
}

function baseParams(overrides = {}) {
  return {
    buffer: Buffer.from("audio-bytes"),
    fileName: "voice.ogg",
    mime: "audio/ogg; codecs=opus",
    model: "gemini-agentforall",
    baseUrl: BASE_URL,
    auth: { kind: "api-key", apiKey: KEY },
    timeoutMs: 5_000,
    ...overrides,
  };
}

function recordingFetch(response) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return typeof response === "function" ? response() : response;
  };
  return { calls, fetchFn };
}

test("posts the audio to the gateway's chat completions endpoint", async () => {
  const { calls, fetchFn } = recordingFetch(transcriptResponse(" שלום "));
  const result = await transcribeAudio(baseParams({ fetchFn }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://litellm.example/v1/chat/completions");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(calls[0].init.headers["content-type"], "application/json");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "gemini-agentforall");
  assert.deepEqual(body.messages[0].content[1], {
    type: "input_audio",
    input_audio: { data: Buffer.from("audio-bytes").toString("base64"), format: "ogg" },
  });
  assert.deepEqual(result, { text: "שלום", model: "gemini-agentforall" });
});

test("a gateway root without /v1 still reaches chat completions", async () => {
  const { calls, fetchFn } = recordingFetch(transcriptResponse("ok"));
  await transcribeAudio(baseParams({ fetchFn, baseUrl: "https://litellm.example/" }));

  assert.equal(calls[0].url, "https://litellm.example/v1/chat/completions");
});

test("configured headers can never override the ones this request owns", async () => {
  const { calls, fetchFn } = recordingFetch(transcriptResponse("ok"));
  await transcribeAudio(
    baseParams({
      fetchFn,
      headers: {
        Authorization: "Bearer someone-else",
        "Content-Type": "text/plain",
        "Content-Length": "9",
        Host: "elsewhere",
        "x-trace": "keep-me",
      },
    }),
  );

  assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  assert.equal(calls[0].init.headers["x-trace"], "keep-me");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.headers["Content-Length"], undefined);
  assert.equal(calls[0].init.headers.Host, undefined);
});

test("headers arriving as a Headers instance or pair list survive the same way", async () => {
  for (const headers of [new Headers({ "x-trace": "keep-me", authorization: "Bearer someone-else" }), [["x-trace", "keep-me"], ["authorization", "Bearer someone-else"]]]) {
    const { calls, fetchFn } = recordingFetch(transcriptResponse("ok"));
    await transcribeAudio(baseParams({ fetchFn, headers }));

    assert.equal(calls[0].init.headers["x-trace"], "keep-me");
    assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
  }
});

test("every buffer shape produces the same base64", async () => {
  const bytes = Buffer.from("audio-bytes");
  const padded = new Uint8Array([0, 0, ...bytes]);
  const view = new Uint8Array(padded.buffer, 2, bytes.byteLength);

  for (const buffer of [bytes, view, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)]) {
    const { calls, fetchFn } = recordingFetch(transcriptResponse("ok"));
    await transcribeAudio(baseParams({ fetchFn, buffer }));
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.messages[0].content[1].input_audio.data, bytes.toString("base64"));
  }
});

test("a resolved key that is only OpenClaw's no-auth marker is not used", async (t) => {
  process.env.AGENTFORALL_MEDIA_API_KEY = "sk-from-env-987654321";
  t.after(() => delete process.env.AGENTFORALL_MEDIA_API_KEY);

  const { calls, fetchFn } = recordingFetch(transcriptResponse("ok"));
  await transcribeAudio(baseParams({ fetchFn, auth: { kind: "api-key", apiKey: "custom-local" } }));

  assert.equal(calls[0].init.headers.authorization, "Bearer sk-from-env-987654321");
});

test("a key with stray whitespace is trimmed before it reaches the header", async () => {
  const { calls, fetchFn } = recordingFetch(transcriptResponse("ok"));
  await transcribeAudio(baseParams({ fetchFn, auth: { kind: "api-key", apiKey: `  ${KEY}  ` } }));

  assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
});

test("the container's own key is used when OpenClaw resolved none", async (t) => {
  process.env.AGENTFORALL_MEDIA_API_KEY = "sk-from-env-987654321";
  t.after(() => delete process.env.AGENTFORALL_MEDIA_API_KEY);

  const { calls, fetchFn } = recordingFetch(transcriptResponse("ok"));
  await transcribeAudio(baseParams({ fetchFn, auth: { kind: "none" }, apiKey: "custom-local" }));

  assert.equal(calls[0].init.headers.authorization, "Bearer sk-from-env-987654321");
});

test("a resolved key wins over the container's", async (t) => {
  process.env.AGENTFORALL_MEDIA_API_KEY = "sk-from-env-987654321";
  t.after(() => delete process.env.AGENTFORALL_MEDIA_API_KEY);

  const { calls, fetchFn } = recordingFetch(transcriptResponse("ok"));
  await transcribeAudio(baseParams({ fetchFn }));

  assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
});

test("the gateway URL falls back to the container's own variable", async (t) => {
  process.env.AGENTFORALL_MEDIA_BASE_URL = "https://fallback.example/v1";
  t.after(() => delete process.env.AGENTFORALL_MEDIA_BASE_URL);

  const { calls, fetchFn } = recordingFetch(transcriptResponse("ok"));
  await transcribeAudio(baseParams({ fetchFn, baseUrl: undefined }));

  assert.equal(calls[0].url, "https://fallback.example/v1/chat/completions");
});

test("an attachment shape we cannot read is named as such, not called empty", async () => {
  const { calls, fetchFn } = recordingFetch(transcriptResponse("ok"));

  await assert.rejects(() => transcribeAudio(baseParams({ fetchFn, buffer: "not-a-buffer" })), /unsupported attachment type/);
  assert.equal(toBuffer("not-a-buffer"), null);
  // An object that only looks buffer-shaped must be refused, not thrown from.
  assert.equal(toBuffer({ byteLength: 5 }), null);
  assert.equal(calls.length, 0);
});

test("a 200 carrying the gateway's own error keeps that reason", async () => {
  const { fetchFn } = recordingFetch(okResponse({ error: { message: `budget exceeded for ${KEY}` } }));

  await assert.rejects(() => transcribeAudio(baseParams({ fetchFn })), (err) => {
    assert.match(err.message, /budget exceeded/);
    assert.ok(!err.message.includes(KEY), "the key leaked into the error");
    return true;
  });
});

test("a truncated transcript is returned but reported", async () => {
  const warnings = [];
  const provider = createMediaUnderstandingProvider({ logger: { warn: (line) => warnings.push(line) } });
  const { fetchFn } = recordingFetch(
    okResponse({ model: "m", choices: [{ finish_reason: "length", message: { content: "half a sentence" } }] }),
  );

  const result = await provider.transcribeAudio(baseParams({ fetchFn }));
  assert.equal(result.text, "half a sentence");
  assert.match(warnings[0], /cut the transcript short/);
});

test("nothing is spent on input the model cannot read", async () => {
  // Explicit: the "no API key" case below must not depend on what other tests left behind.
  delete process.env.AGENTFORALL_MEDIA_API_KEY;
  delete process.env.AGENTFORALL_MEDIA_BASE_URL;
  const { calls, fetchFn } = recordingFetch(transcriptResponse("ok"));

  await assert.rejects(() => transcribeAudio(baseParams({ fetchFn, mime: "audio/amr", fileName: "note.amr" })), /unsupported audio format/);
  await assert.rejects(() => transcribeAudio(baseParams({ fetchFn, buffer: Buffer.alloc(0) })), /attachment was empty/);
  await assert.rejects(() => transcribeAudio(baseParams({ fetchFn, buffer: undefined })), /unsupported attachment type/);
  await assert.rejects(() => transcribeAudio(baseParams({ fetchFn, model: "  " })), /no model configured/);
  await assert.rejects(() => transcribeAudio(baseParams({ fetchFn, baseUrl: undefined })), /no usable gateway URL/);
  await assert.rejects(() => transcribeAudio(baseParams({ fetchFn, baseUrl: "not a url" })), /no usable gateway URL/);
  await assert.rejects(
    () => transcribeAudio(baseParams({ fetchFn, auth: { kind: "none" }, apiKey: "custom-local" })),
    /no API key available/,
  );
  assert.equal(calls.length, 0);
});

test("only a timeout AbortSignal accepts is passed on; anything else uses the default", () => {
  assert.equal(resolveTimeoutMs(5_000), 5_000);
  // AbortSignal.timeout refuses non-integers and anything past a 32-bit delay.
  for (const bad of [0, -1, 1.5, 5e9, Number.NaN, Number.POSITIVE_INFINITY, "90000", null, undefined]) {
    assert.equal(resolveTimeoutMs(bad), 90_000, `expected the default for ${String(bad)}`);
  }
});

test("an unusable timeout still reaches the gateway, with a signal attached", async () => {
  for (const timeoutMs of [0, 1.5, 5e9, Number.NaN, "90000", undefined]) {
    const { calls, fetchFn } = recordingFetch(transcriptResponse("ok"));
    await transcribeAudio(baseParams({ fetchFn, timeoutMs }));
    assert.equal(calls.length, 1);
    assert.ok(calls[0].init.signal instanceof AbortSignal);
  }
});

test("a failed request is reported with the standard prefix and keeps its cause", async () => {
  const cause = new Error("connect ECONNREFUSED");
  const fetchFn = async () => {
    throw cause;
  };
  await assert.rejects(() => transcribeAudio(baseParams({ fetchFn })), (err) => {
    assert.match(err.message, /^Audio transcription failed: connect ECONNREFUSED$/);
    assert.equal(err.cause, cause);
    return true;
  });
});

test("a timeout says so", async () => {
  const fetchFn = async () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    throw err;
  };
  await assert.rejects(() => transcribeAudio(baseParams({ fetchFn })), /the gateway timed out/);
});

test("an error status is reported without ever echoing the key", async () => {
  const fetchFn = async () => ({
    ok: false,
    status: 400,
    text: async () => `bad request for key ${KEY} (sk-another-key-1234567890)`,
  });

  await assert.rejects(() => transcribeAudio(baseParams({ fetchFn })), (err) => {
    assert.match(err.message, /returned 400/);
    assert.ok(!err.message.includes(KEY), "the key leaked into the error");
    assert.ok(!err.message.includes("sk-another-key-1234567890"), "another key leaked into the error");
    return true;
  });
});

test("an auth failure reports the status alone, never the body", async () => {
  const fetchFn = async () => ({
    ok: false,
    status: 401,
    text: async () => `Received API Key = ${KEY}`,
  });

  await assert.rejects(() => transcribeAudio(baseParams({ fetchFn })), (err) => {
    assert.equal(err.message, "Audio transcription failed: the gateway returned 401");
    return true;
  });
});

test("a body that is not JSON is reported, not swallowed", async () => {
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("Unexpected token <");
    },
  });
  await assert.rejects(() => transcribeAudio(baseParams({ fetchFn })), /response was not JSON/);
});

test("a response with no transcript is reported with the standard prefix", async () => {
  const { fetchFn } = recordingFetch(okResponse({ choices: [{ message: {} }] }));
  await assert.rejects(() => transcribeAudio(baseParams({ fetchFn })), /^Error: Audio transcription failed: response had no message content$/);
});

test("failures are logged, because a silent one just leaves the voice note unanswered", async () => {
  const warnings = [];
  const provider = createMediaUnderstandingProvider({ logger: { warn: (line) => warnings.push(line) } });
  const fetchFn = async () => {
    throw new Error("connect ECONNREFUSED");
  };

  await assert.rejects(() => provider.transcribeAudio(baseParams({ fetchFn })));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^\[agentforall-media\] Audio transcription failed/);
});

test("the provider declares audio only, and no auto-detection priority", () => {
  const provider = createMediaUnderstandingProvider();

  assert.equal(provider.id, PROVIDER_ID);
  assert.deepEqual(provider.capabilities, ["audio"]);
  assert.equal(provider.autoPriority, undefined);
  assert.equal(typeof provider.transcribeAudio, "function");
  assert.equal(PROVIDER_ID, PLUGIN_ID);
});

test("redactKeys hides both the configured key and anything key-shaped", () => {
  assert.equal(redactKeys(`a ${KEY} b`, KEY), "a sk-*** b");
  assert.equal(redactKeys("sk-abcdefghijkl", undefined), "sk-***");
  assert.equal(redactKeys("nothing here", KEY), "nothing here");
  // A gateway key need not look like an OpenAI one, which is why the exact match exists too.
  assert.equal(redactKeys("token=Bearer-abc-123 rejected", "Bearer-abc-123"), "token=sk-*** rejected");
});

test("a logger that throws does not replace the failure the caller is about to see", async () => {
  const provider = createMediaUnderstandingProvider({
    logger: {
      warn() {
        throw new Error("logger is down");
      },
    },
  });
  const fetchFn = async () => {
    throw new Error("connect ECONNREFUSED");
  };

  await assert.rejects(() => provider.transcribeAudio(baseParams({ fetchFn })), /connect ECONNREFUSED/);
});
