import { test } from "node:test";
import assert from "node:assert/strict";
import { ComposioIntegrationProvider } from "../src/services/integrations/composio/adapter.js";
import { ComposioApiError, type ComposioClient } from "../src/services/integrations/composio/client.js";
import { SessionGoneError } from "../src/services/integrations/provider.js";

function provider(overrides: Partial<ComposioClient>): ComposioIntegrationProvider {
  const client = { authHeaders: () => ({ "x-api-key": "k" }), ...overrides } as ComposioClient;
  return new ComposioIntegrationProvider(client);
}

test("connections map upstream statuses to the domain vocabulary", async () => {
  const p = provider({
    listConnectedAccounts: async () => [
      { id: "1", status: "ACTIVE", toolkit: { slug: "gmail" }, created_at: "2026-08-01T00:00:00Z" },
      { id: "2", status: "initiated", toolkit: { slug: "notion" } },
      { id: "3", status: "SOMETHING_NEW" },
    ],
  });

  const connections = await p.listConnections("inst-1");

  assert.deepEqual(connections, [
    { ref: "1", app: "gmail", status: "active", createdAt: "2026-08-01T00:00:00Z" },
    { ref: "2", app: "notion", status: "pending", createdAt: null },
    { ref: "3", app: "unknown", status: "failed", createdAt: null },
  ]);
});

test("a 404 on link creation surfaces as a gone session so the caller can recreate", async () => {
  const p = provider({
    createLink: async () => {
      throw new ComposioApiError(404, "/link", "no session");
    },
  });

  await assert.rejects(
    p.createConnectLink({ providerSessionId: "s", app: "gmail", callbackUrl: "https://app/cb" }),
    SessionGoneError,
  );
});

test("catalog entries carry logo, description and category names", async () => {
  const p = provider({
    listToolkits: async () => [
      {
        slug: "gmail",
        name: "Gmail",
        no_auth: false,
        meta: {
          logo: "https://logo/gmail.png",
          description: "Mail",
          categories: [{ id: "email", name: "Email" }, { id: "x" }],
        },
      },
    ],
  });

  const catalog = await p.listCatalog();

  assert.deepEqual(catalog, [
    {
      slug: "gmail",
      name: "Gmail",
      logo: "https://logo/gmail.png",
      description: "Mail",
      categories: ["Email", "x"],
      noAuth: false,
    },
  ]);
});

test("upstream headers are the project key the relay must add", () => {
  assert.deepEqual(provider({}).upstreamHeaders(), { "x-api-key": "k" });
});
