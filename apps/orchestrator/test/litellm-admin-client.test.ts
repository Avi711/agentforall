import { test } from "node:test";
import assert from "node:assert/strict";
import { LiteLlmAdminClient } from "../src/services/litellm-admin-client.js";

test("LiteLLM key generation sends budget, models, and owner metadata", async () => {
  let request: { url: string; body: unknown; authorization: string | null } | null =
    null;
  const fetchImpl: typeof fetch = async (input, init) => {
    request = {
      url: input.toString(),
      body: JSON.parse(String(init?.body)),
      authorization: new Headers(init?.headers).get("authorization"),
    };
    return new Response(
      JSON.stringify({
        key: "sk-bot",
        key_alias: "agentforall-test",
        token: "hashed-key",
      }),
      { status: 200 },
    );
  };

  const client = new LiteLlmAdminClient(
    "https://litellm.example/v1",
    "master-key",
    fetchImpl,
  );
  const key = await client.generateKey({
    instanceId: "instance-1",
    userId: "user-1",
    keyAlias: "agentforall-test",
    models: ["gemini-agentforall"],
    maxBudgetCents: 5000,
    budgetDuration: "30d",
  });

  assert.deepEqual(key, {
    key: "sk-bot",
    keyAlias: "agentforall-test",
    keyHash: "hashed-key",
  });
  assert.equal(request?.url, "https://litellm.example/key/generate");
  assert.equal(request?.authorization, "Bearer master-key");
  assert.deepEqual(request?.body, {
    key_alias: "agentforall-test",
    models: ["gemini-agentforall"],
    max_budget: 50,
    budget_duration: "30d",
    user_id: "user-1",
    metadata: {
      service: "agentforall",
      instance_id: "instance-1",
      user_id: "user-1",
    },
  });
});

test("LiteLLM key usage reads spend and budget from key info", async () => {
  let request: { url: string; authorization: string | null } | null = null;
  const fetchImpl: typeof fetch = async (input, init) => {
    request = {
      url: input.toString(),
      authorization: new Headers(init?.headers).get("authorization"),
    };
    return new Response(
      JSON.stringify({
        info: {
          spend: 1.234,
          max_budget: 50,
          budget_duration: "30d",
          budget_reset_at: "2026-09-01T00:00:00+00:00",
          key_alias: "agentforall-test",
          models: ["gemini-agentforall"],
        },
      }),
      { status: 200 },
    );
  };

  const client = new LiteLlmAdminClient(
    "https://litellm.example/v1",
    "master-key",
    fetchImpl,
  );
  const usage = await client.getKeyUsage("sk-bot");

  assert.deepEqual(usage, {
    spendCents: 123,
    maxBudgetCents: 5000,
    budgetDuration: "30d",
    budgetResetAt: "2026-09-01T00:00:00+00:00",
    keyAlias: "agentforall-test",
    models: ["gemini-agentforall"],
  });
  assert.equal(request?.url, "https://litellm.example/key/info?key=sk-bot");
  assert.equal(request?.authorization, "Bearer master-key");
});
