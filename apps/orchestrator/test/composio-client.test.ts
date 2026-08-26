import { test } from "node:test";
import assert from "node:assert/strict";
import { ComposioApiError, ComposioClient } from "../src/services/integrations/composio/client.js";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(responder: (call: Call, attempt: number) => Response) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return responder(call, calls.length);
  };
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("createSession posts the per-bot user id with agent-managed connections but no removal", async () => {
  const { calls, fetchImpl } = fakeFetch(() =>
    json({ session_id: "sess_1", mcp: { type: "http", url: "https://mcp.example/sess_1" } }, 201),
  );
  const client = new ComposioClient("https://api.example", "key_123", fetchImpl);

  const session = await client.createSession({ userId: "inst-1", callbackUrl: "https://app/cb" });

  assert.equal(session.session_id, "sess_1");
  assert.equal(session.mcp.url, "https://mcp.example/sess_1");
  assert.equal(calls[0]?.url, "https://api.example/api/v3.1/tool_router/session");
  assert.equal(calls[0]?.headers["x-api-key"], "key_123");
  assert.deepEqual(calls[0]?.body, {
    user_id: "inst-1",
    manage_connections: {
      enable: true,
      callback_url: "https://app/cb",
      enable_wait_for_connections: true,
      enable_connection_removal: false,
    },
  });
});

test("createLink targets the session and returns the hosted redirect", async () => {
  const { calls, fetchImpl } = fakeFetch(() =>
    json({ link_token: "lt", redirect_url: "https://connect.example/x", connected_account_id: "ca_9" }, 201),
  );
  const client = new ComposioClient("https://api.example", "k", fetchImpl);

  const link = await client.createLink("sess 1", "gmail", "https://app/cb?connected=gmail");

  assert.equal(calls[0]?.url, "https://api.example/api/v3.1/tool_router/session/sess%201/link");
  assert.deepEqual(calls[0]?.body, { toolkit: "gmail", callback_url: "https://app/cb?connected=gmail" });
  assert.equal(link.connected_account_id, "ca_9");
});

test("listConnectedAccounts follows the cursor and tolerates unknown fields", async () => {
  const { calls, fetchImpl } = fakeFetch((call) =>
    call.url.includes("cursor=c2")
      ? json({ items: [{ id: "b", status: "EXPIRED", extra: 1 }], next_cursor: null })
      : json({ items: [{ id: "a", status: "ACTIVE", toolkit: { slug: "gmail" } }], next_cursor: "c2" }),
  );
  const client = new ComposioClient("https://api.example", "k", fetchImpl);

  const accounts = await client.listConnectedAccounts("inst-1");

  assert.deepEqual(accounts.map((a) => a.id), ["a", "b"]);
  assert.equal(calls.length, 2);
  assert.match(calls[0]?.url ?? "", /user_ids=inst-1/);
});

test("deleteConnectedAccount revokes upstream and treats 404 as done", async () => {
  const { calls, fetchImpl } = fakeFetch(() => new Response("gone", { status: 404 }));
  const client = new ComposioClient("https://api.example", "k", fetchImpl);

  await client.deleteConnectedAccount("ca_9");

  assert.equal(calls[0]?.method, "DELETE");
  assert.equal(calls[0]?.url, "https://api.example/api/v3/connected_accounts/ca_9?revoke_on_delete=true");
});

test("idempotent calls retry on 503, non-idempotent session creation does not", async () => {
  const flaky = fakeFetch((_call, attempt) =>
    attempt === 1 ? new Response("down", { status: 503 }) : json({ items: [], next_cursor: null }),
  );
  const client = new ComposioClient("https://api.example", "k", flaky.fetchImpl);
  const accounts = await client.listConnectedAccounts("inst-1");
  assert.deepEqual(accounts, []);
  assert.equal(flaky.calls.length, 2);

  const failing = fakeFetch(() => new Response("down", { status: 503 }));
  const strict = new ComposioClient("https://api.example", "k", failing.fetchImpl);
  await assert.rejects(
    strict.createSession({ userId: "inst-1", callbackUrl: "https://app/cb" }),
    (err: unknown) => err instanceof ComposioApiError && err.status === 503,
  );
  assert.equal(failing.calls.length, 1);
});

test("listToolkits asks for composio-managed toolkits sorted by usage", async () => {
  const { calls, fetchImpl } = fakeFetch(() =>
    json({ items: [{ slug: "gmail", name: "Gmail", meta: { description: "Mail" } }], next_cursor: null }),
  );
  const client = new ComposioClient("https://api.example", "k", fetchImpl);

  const toolkits = await client.listToolkits();

  assert.equal(toolkits[0]?.slug, "gmail");
  assert.match(calls[0]?.url ?? "", /managed_by=composio/);
  assert.match(calls[0]?.url ?? "", /sort_by=usage/);
});
