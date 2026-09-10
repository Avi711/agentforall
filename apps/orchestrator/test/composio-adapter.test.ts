import { test } from "node:test";
import assert from "node:assert/strict";
import { ComposioIntegrationProvider } from "../src/services/integrations/composio/adapter.js";
import { ComposioApiError, type ComposioClient } from "../src/services/integrations/composio/client.js";
import { LabelConflictError, SessionGoneError } from "../src/services/integrations/provider.js";

function provider(overrides: Partial<ComposioClient>): ComposioIntegrationProvider {
  const client = { authHeaders: () => ({ "x-api-key": "k" }), ...overrides } as ComposioClient;
  return new ComposioIntegrationProvider(client);
}

test("connections map upstream statuses to the domain vocabulary", async () => {
  const p = provider({
    listConnectedAccounts: async () => [
      { id: "1", status: "ACTIVE", alias: "עבודה", toolkit: { slug: "gmail" }, created_at: "2026-08-01T00:00:00Z" },
      { id: "2", status: "initiated", alias: null, toolkit: { slug: "notion" } },
      { id: "3", status: "SOMETHING_NEW" },
      { id: "4", status: "ACTIVE", alias: " ", toolkit: { slug: "gmail" } },
    ],
  });

  const connections = await p.listConnections("inst-1");

  assert.deepEqual(connections, [
    { ref: "1", app: "gmail", status: "active", label: "עבודה", createdAt: "2026-08-01T00:00:00Z" },
    { ref: "2", app: "notion", status: "pending", label: null, createdAt: null },
    { ref: "3", app: "unknown", status: "failed", label: null, createdAt: null },
    { ref: "4", app: "gmail", status: "active", label: null, createdAt: null },
  ]);
});

test("sessions carry the cap they are given, links the label as the alias, renames the new alias", async () => {
  const sessions: unknown[] = [];
  const links: unknown[] = [];
  const aliases: [string, string][] = [];
  const p = provider({
    createSession: async (input) => {
      sessions.push(input);
      return { session_id: "s", mcp: { url: "https://mcp/s" } };
    },
    createLink: async (input) => {
      links.push(input);
      return { redirect_url: "https://connect/x", connected_account_id: "ca_1" };
    },
    setConnectedAccountAlias: async (id, alias) => {
      aliases.push([id, alias]);
    },
  });

  await p.createSession({ instanceId: "inst-1", callbackUrl: "https://app/cb", maxAccountsPerApp: 4 });
  await p.createConnectLink({ providerSessionId: "s", app: "gmail", callbackUrl: "https://app/cb", label: "אישי" });
  await p.renameConnection("ca_1", "עבודה");

  assert.deepEqual(sessions, [{ userId: "inst-1", callbackUrl: "https://app/cb", maxAccountsPerToolkit: 4 }]);
  assert.deepEqual(links, [{ sessionId: "s", toolkit: "gmail", callbackUrl: "https://app/cb", alias: "אישי" }]);
  assert.deepEqual(aliases, [["ca_1", "עבודה"]]);
});

test("a 404 on link creation or on enabling multi-account surfaces as a gone session so the caller can recreate", async () => {
  const gone = async () => {
    throw new ComposioApiError(404, "/session", "no session");
  };
  const p = provider({ createLink: gone, enableMultiAccount: gone });

  await assert.rejects(
    p.createConnectLink({ providerSessionId: "s", app: "gmail", callbackUrl: "https://app/cb" }),
    SessionGoneError,
  );
  await assert.rejects(p.allowMultipleAccounts("s", 3), SessionGoneError);
});

test("a 409 on an alias surfaces as a label conflict; other failures stay as they are", async () => {
  const conflict = async () => {
    throw new ComposioApiError(409, "/alias", "duplicate");
  };
  const p = provider({ createLink: conflict, setConnectedAccountAlias: conflict });

  await assert.rejects(
    p.createConnectLink({ providerSessionId: "s", app: "gmail", callbackUrl: "https://app/cb", label: "אישי" }),
    LabelConflictError,
  );
  await assert.rejects(p.renameConnection("ca_1", "עבודה"), LabelConflictError);

  const failing = provider({
    setConnectedAccountAlias: async () => {
      throw new ComposioApiError(500, "/alias", "boom");
    },
  });
  await assert.rejects(failing.renameConnection("ca_1", "עבודה"), ComposioApiError);
});

test("allowMultipleAccounts passes the cap through and other failures stay as they are", async () => {
  const calls: [string, number][] = [];
  const ok = provider({
    enableMultiAccount: async (id, max) => {
      calls.push([id, max]);
    },
  });
  await ok.allowMultipleAccounts("s", 3);
  assert.deepEqual(calls, [["s", 3]]);

  const failing = provider({
    enableMultiAccount: async () => {
      throw new ComposioApiError(500, "/session", "boom");
    },
  });
  await assert.rejects(failing.allowMultipleAccounts("s", 3), ComposioApiError);
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
