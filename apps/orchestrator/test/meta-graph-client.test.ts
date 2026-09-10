import { test } from "node:test";
import assert from "node:assert/strict";
import { MetaGraphClient, MetaGraphError } from "../src/services/whatsapp-cloud/graph-client.js";

interface Seen {
  url: string;
  method: string;
  auth: string | null;
  body: unknown;
}

function fakeFetch(responder: (seen: Seen, attempt: number) => Response) {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const entry: Seen = {
      url: String(input),
      method: init?.method ?? "GET",
      auth: headers.get("authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    seen.push(entry);
    return responder(entry, seen.length);
  }) as typeof fetch;
  return { seen, fetchImpl };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const metaError = (code: number, message = "boom") => ({ error: { message, type: "OAuthException", code, fbtrace_id: "t" } });

test("requests carry the tenant token, the api version and the path", async () => {
  const { seen, fetchImpl } = fakeFetch(() => json(200, { success: true }));
  const client = new MetaGraphClient("https://graph.facebook.com", "v24.0", fetchImpl);

  await client.subscribeApp("waba-1", "tok");

  assert.equal(seen[0]?.url, "https://graph.facebook.com/v24.0/waba-1/subscribed_apps");
  assert.equal(seen[0]?.method, "POST");
  assert.equal(seen[0]?.auth, "Bearer tok");
});

test("idempotent calls retry a 5xx once the wire settles; sends never retry", async () => {
  let subscribeCalls = 0;
  const { fetchImpl } = fakeFetch((seen) => {
    if (seen.url.endsWith("/subscribed_apps")) {
      subscribeCalls += 1;
      return subscribeCalls === 1 ? json(503, metaError(2, "temporarily unavailable")) : json(200, { success: true });
    }
    return json(500, metaError(1, "unknown"));
  });
  const client = new MetaGraphClient("https://graph.facebook.com", "v24.0", fetchImpl);

  await client.subscribeApp("waba-1", "tok");
  assert.equal(subscribeCalls, 2);

  let sendCalls = 0;
  const sender = new MetaGraphClient("https://graph.facebook.com", "v24.0", (async (...args: Parameters<typeof fetch>) => {
    sendCalls += 1;
    return fetchImpl(...args);
  }) as typeof fetch);
  await assert.rejects(sender.sendText("2000", "tok", { to: "972501234567", text: "hi" }), MetaGraphError);
  assert.equal(sendCalls, 1);
});

test("a Meta error envelope becomes a typed error with its code", async () => {
  const { fetchImpl } = fakeFetch(() => json(400, metaError(190, "Invalid OAuth access token")));
  const client = new MetaGraphClient("https://graph.facebook.com", "v24.0", fetchImpl);

  await assert.rejects(client.getPhoneNumber("2000", "tok"), (err: unknown) => {
    assert.ok(err instanceof MetaGraphError);
    assert.equal(err.status, 400);
    assert.equal(err.code, 190);
    return true;
  });
});

test("sending a reply posts Meta's shape with the quoted message and returns the wamid", async () => {
  const { seen, fetchImpl } = fakeFetch(() => json(200, { messaging_product: "whatsapp", messages: [{ id: "wamid.1" }] }));
  const client = new MetaGraphClient("https://graph.facebook.com", "v24.0", fetchImpl);

  const wamid = await client.sendText("2000", "tok", { to: "972501234567", text: "שלום", replyToId: "wamid.0" });

  assert.equal(wamid, "wamid.1");
  assert.deepEqual(seen[0]?.body, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "972501234567",
    type: "text",
    text: { preview_url: false, body: "שלום" },
    context: { message_id: "wamid.0" },
  });
});

test("the phone number lookup normalises the display number to E.164", async () => {
  const { seen, fetchImpl } = fakeFetch(() =>
    json(200, { display_phone_number: "+972 50-111-2233", verified_name: "Shop" }),
  );
  const client = new MetaGraphClient("https://graph.facebook.com", "v24.0", fetchImpl);

  const facts = await client.getPhoneNumber("2000", "tok");

  assert.deepEqual(facts, { displayPhoneNumber: "+972501112233", verifiedName: "Shop" });
  assert.match(seen[0]?.url ?? "", /\/v24\.0\/2000\?fields=/);
});

test("marking read can carry the typing indicator", async () => {
  const { seen, fetchImpl } = fakeFetch(() => json(200, { success: true }));
  const client = new MetaGraphClient("https://graph.facebook.com", "v24.0", fetchImpl);

  await client.markRead("2000", "tok", "wamid.9", true);

  assert.deepEqual(seen[0]?.body, {
    messaging_product: "whatsapp",
    status: "read",
    message_id: "wamid.9",
    typing_indicator: { type: "text" },
  });
});

test("media is fetched only from Meta's CDN over https, without following redirects, and carries the caller's abort", async () => {
  const { seen, fetchImpl } = fakeFetch(() => new Response("bytes", { status: 200, headers: { "content-type": "image/png" } }));
  const client = new MetaGraphClient("https://graph.facebook.com", "v24.0", fetchImpl);

  for (const url of ["https://evil.example/x", "http://lookaside.fbsbx.com/x", "not a url"]) {
    await assert.rejects(client.downloadMedia({ url, mimeType: "image/png" }, "tok"), (err: unknown) => {
      assert.ok(err instanceof MetaGraphError);
      assert.equal(err.status, 403);
      return true;
    });
  }
  assert.equal(seen.length, 0);

  const gone = new AbortController();
  const download = await client.downloadMedia({ url: "https://lookaside.fbsbx.com/whatsapp/m1", mimeType: "image/jpeg" }, "tok", gone.signal);
  assert.equal(download.contentType, "image/png");
  assert.equal(seen[0]?.auth, "Bearer tok");
  assert.equal(await new Response(download.body as unknown as ReadableStream).text(), "bytes");

  const aborting = new AbortController();
  const honoursAbort = new MetaGraphClient(
    "https://graph.facebook.com",
    "v24.0",
    (async (_input: string | URL | Request, init?: RequestInit) => {
      aborting.abort();
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return new Response("late", { status: 200 });
    }) as typeof fetch,
  );
  await assert.rejects(
    honoursAbort.downloadMedia({ url: "https://lookaside.fbsbx.com/whatsapp/m2", mimeType: "image/jpeg" }, "tok", aborting.signal),
    (err: unknown) => err instanceof DOMException && err.name === "AbortError",
  );
});

test("a redirect or an oversized declaration is refused before any body is read", async () => {
  const redirect = new MetaGraphClient("https://graph.facebook.com", "v24.0", fakeFetch(() => new Response(null, { status: 302, headers: { location: "https://elsewhere.example" } })).fetchImpl);
  await assert.rejects(redirect.downloadMedia({ url: "https://lookaside.fbsbx.com/x", mimeType: "image/png" }, "tok"), (err: unknown) => {
    assert.ok(err instanceof MetaGraphError);
    assert.equal(err.status, 302);
    return true;
  });

  const huge = new MetaGraphClient(
    "https://graph.facebook.com",
    "v24.0",
    fakeFetch(() => new Response("x", { status: 200, headers: { "content-length": String(101 * 1024 * 1024) } })).fetchImpl,
  );
  await assert.rejects(huge.downloadMedia({ url: "https://lookaside.fbsbx.com/x", mimeType: "image/png" }, "tok"), (err: unknown) => {
    assert.ok(err instanceof MetaGraphError);
    assert.equal(err.status, 413);
    return true;
  });
});
