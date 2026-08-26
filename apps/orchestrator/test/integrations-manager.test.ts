import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import {
  AuthenticationError,
  FeatureUnavailableError,
  InvalidStateError,
  NotFoundError,
  UpstreamUnavailableError,
  ValidationError,
} from "../src/domain/errors.js";
import type { CatalogApp, IntegrationConnection, IntegrationSession } from "../src/domain/integrations.js";
import type { ConfigPatch, Instance } from "../src/domain/types.js";
import { IntegrationsManager } from "../src/services/integrations/manager.js";
import { SessionGoneError, type IntegrationProvider } from "../src/services/integrations/provider.js";
import { IntegrationSessions } from "../src/services/integrations/sessions.js";
import { makeInstance } from "./helpers/fixtures.js";

const RETURN_URL = "https://agentforall.co.il/app/bot/connections?connected=gmail";
const noLog = { info() {}, warn() {}, error() {} } as unknown as FastifyBaseLogger;

interface Overrides {
  instance?: Partial<Instance>;
  linkFailures?: number;
  catalog?: () => Promise<CatalogApp[]>;
}

function harness(overrides: Overrides = {}) {
  let instance = makeInstance([{ type: "whatsapp" }], overrides.instance);
  const calls = {
    createSession: 0,
    deleteSession: [] as string[],
    links: [] as { session: string; app: string; callbackUrl: string }[],
    revoked: [] as string[],
    updateConfig: [] as ConfigPatch[],
    events: [] as string[],
  };
  let connections: IntegrationConnection[] = [];
  let linkFailures = overrides.linkFailures ?? 0;
  let listError: Error | null = null;

  const provider: IntegrationProvider = {
    name: "mock",
    listCatalog: overrides.catalog ?? (async () => [{ slug: "gmail", name: "Gmail", logo: null, description: null, categories: [], noAuth: false }]),
    createSession: async () => {
      calls.createSession += 1;
      return { providerSessionId: `sess-${calls.createSession}`, upstreamMcpUrl: `https://mcp/${calls.createSession}` };
    },
    deleteSession: async (id) => {
      calls.deleteSession.push(id);
    },
    createConnectLink: async (input) => {
      if (linkFailures > 0) {
        linkFailures -= 1;
        throw new SessionGoneError(input.providerSessionId);
      }
      calls.links.push({ session: input.providerSessionId, app: input.app, callbackUrl: input.callbackUrl });
      connections.push({ ref: `ref-${calls.links.length}`, app: input.app, status: "active", createdAt: null });
      return { url: `https://connect/${input.app}`, ref: `ref-${calls.links.length}` };
    },
    listConnections: async () => {
      if (listError) throw listError;
      return connections;
    },
    revokeConnection: async (ref) => {
      calls.revoked.push(ref);
      connections = connections.filter((c) => c.ref !== ref);
    },
    upstreamHeaders: () => ({ "x-api-key": "project-key" }),
  };

  const rows = new Map<string, IntegrationSession>();
  const store = {
    findByInstanceId: async (id: string) => rows.get(id) ?? null,
    upsert: async (input: { instanceId: string; provider: "mock" | "composio"; providerSessionId: string; upstreamMcpUrl: string }) => {
      const row: IntegrationSession = { ...input, createdAt: new Date(), updatedAt: new Date() };
      rows.set(input.instanceId, row);
      return row;
    },
    deleteByInstanceId: async (id: string) => {
      rows.delete(id);
    },
  };
  const eventLog = {
    append: async (_id: string, type: string) => {
      calls.events.push(type);
    },
  };
  const sessions = new IntegrationSessions(store, provider, eventLog, noLog);

  const manager = {
    get: async (id: string, userId: string) => {
      if (id !== instance.id || userId !== instance.userId) throw new Error("not owner");
      return instance;
    },
    updateConfig: async (_id: string, _userId: string, patch: ConfigPatch) => {
      calls.updateConfig.push(patch);
      instance = {
        ...instance,
        config: { ...instance.config, ...(patch.integrations ? { integrations: patch.integrations } : {}) },
      };
      return instance;
    },
  };
  const instances = { findById: async (id: string) => (id === instance.id ? instance : null) };

  let now = 0;
  const integrations = new IntegrationsManager(
    manager,
    instances,
    sessions,
    provider,
    eventLog,
    { orchestratorInternalUrl: "http://orchestrator:3000", dashboardOrigin: "https://agentforall.co.il" },
    noLog,
    () => now,
  );

  return {
    integrations,
    sessions,
    calls,
    instance: () => instance,
    rows,
    advance: (ms: number) => {
      now += ms;
    },
    failListWith: (err: Error) => {
      listError = err;
    },
  };
}

test("first connect creates one session, binds the relay once, and returns the hosted link", async () => {
  const h = harness();
  const inst = h.instance();

  const [a, b] = await Promise.all([
    h.integrations.connect(inst.id, inst.userId, "gmail", RETURN_URL),
    h.integrations.connect(inst.id, inst.userId, "notion", RETURN_URL),
  ]);

  assert.equal(a.url, "https://connect/gmail");
  assert.equal(b.url, "https://connect/notion");
  assert.equal(h.calls.createSession, 1);
  assert.equal(h.calls.updateConfig.length, 1);
  const binding = h.instance().config.integrations;
  assert.equal(binding?.relayUrl, `http://orchestrator:3000/api/v1/mcp/${inst.id}`);
  assert.match(binding?.relayToken ?? "", /^[0-9a-f]{64}$/);
  assert.deepEqual(h.calls.links.map((l) => l.callbackUrl), [RETURN_URL, RETURN_URL]);
  assert.ok(h.calls.events.includes("integration.session_created"));
  assert.ok(h.calls.events.includes("integration.connect_requested"));
});

test("a vanished upstream session is recreated once and the link still comes back", async () => {
  const h = harness({ linkFailures: 1 });
  const inst = h.instance();

  const link = await h.integrations.connect(inst.id, inst.userId, "gmail", RETURN_URL);

  assert.equal(link.url, "https://connect/gmail");
  assert.equal(h.calls.createSession, 2);
  assert.equal(h.rows.get(inst.id)?.providerSessionId, "sess-2");
  assert.equal(h.calls.links[0]?.session, "sess-2");
});

test("connect refuses foreign return urls and non-openclaw runtimes", async () => {
  const h = harness();
  const inst = h.instance();
  await assert.rejects(
    h.integrations.connect(inst.id, inst.userId, "gmail", "https://evil.example/cb"),
    ValidationError,
  );

  const hermes = harness({ instance: { runtimeKind: "hermes" } });
  await assert.rejects(
    hermes.integrations.connect(hermes.instance().id, hermes.instance().userId, "gmail", RETURN_URL),
    FeatureUnavailableError,
  );
  assert.equal(h.calls.createSession + hermes.calls.createSession, 0);
});

test("connect refuses a bot that is being destroyed and creates nothing upstream", async () => {
  const h = harness({ instance: { status: "destroying" } });
  const inst = h.instance();
  await assert.rejects(h.integrations.connect(inst.id, inst.userId, "gmail", RETURN_URL), InvalidStateError);
  assert.equal(h.calls.createSession, 0);
});

test("provider failures reach callers as a bare upstream error without vendor detail", async () => {
  const h = harness();
  const inst = h.instance();
  await h.integrations.connect(inst.id, inst.userId, "gmail", RETURN_URL);
  h.failListWith(new Error("Composio /api/v3/connected_accounts failed: 500 secret-internal-detail"));

  await assert.rejects(h.integrations.list(inst.id, inst.userId), (err: unknown) => {
    assert.ok(err instanceof UpstreamUnavailableError);
    assert.doesNotMatch(err.message, /secret-internal-detail/);
    return true;
  });
});

test("list is empty without a session and never calls the provider", async () => {
  let listed = 0;
  const h = harness();
  const inst = h.instance();
  const original = h.sessions.find.bind(h.sessions);
  h.sessions.find = async (id) => {
    listed += 1;
    return original(id);
  };

  assert.deepEqual(await h.integrations.list(inst.id, inst.userId), []);
  assert.equal(listed, 1);
});

test("disconnect only revokes refs that belong to the bot", async () => {
  const h = harness();
  const inst = h.instance();
  await h.integrations.connect(inst.id, inst.userId, "gmail", RETURN_URL);

  await assert.rejects(h.integrations.disconnect(inst.id, inst.userId, "ref-other"), NotFoundError);
  await h.integrations.disconnect(inst.id, inst.userId, "ref-1");

  assert.deepEqual(h.calls.revoked, ["ref-1"]);
  assert.ok(h.calls.events.includes("integration.disconnected"));
});

test("resolveRelay accepts only the bound token of a live bot", async () => {
  const h = harness();
  const inst = h.instance();
  await assert.rejects(h.integrations.resolveRelay(inst.id, "anything"), AuthenticationError);

  await h.integrations.connect(inst.id, inst.userId, "gmail", RETURN_URL);
  const token = h.instance().config.integrations?.relayToken ?? "";

  const target = await h.integrations.resolveRelay(inst.id, token);
  assert.deepEqual(target, { upstreamUrl: "https://mcp/1", headers: { "x-api-key": "project-key" } });
  await assert.rejects(h.integrations.resolveRelay(inst.id, `${token}x`), AuthenticationError);
  await assert.rejects(h.integrations.resolveRelay("22222222-2222-4222-8222-222222222222", token), AuthenticationError);
});

test("resolveRelay refuses a bot that is being destroyed", async () => {
  const h = harness();
  const inst = h.instance();
  await h.integrations.connect(inst.id, inst.userId, "gmail", RETURN_URL);
  const token = h.instance().config.integrations?.relayToken ?? "";
  const destroying = harness({ instance: { status: "destroying", config: h.instance().config } });
  await destroying.sessions.ensure(inst.id, "https://agentforall.co.il/app/bot/connections");

  await assert.rejects(destroying.integrations.resolveRelay(inst.id, token), AuthenticationError);
});

test("revokeAll drops every connection, the upstream session, and our row", async () => {
  const h = harness();
  const inst = h.instance();
  await h.integrations.connect(inst.id, inst.userId, "gmail", RETURN_URL);
  await h.integrations.connect(inst.id, inst.userId, "notion", RETURN_URL);

  await h.sessions.revokeAll(h.instance());

  assert.deepEqual(h.calls.revoked, ["ref-1", "ref-2"]);
  assert.deepEqual(h.calls.deleteSession, ["sess-1"]);
  assert.equal(h.rows.has(inst.id), false);
  assert.ok(h.calls.events.includes("integration.revoked_all"));
});

test("catalog is cached for an hour and served stale when the provider fails", async () => {
  let fetches = 0;
  let fail = false;
  const h = harness({
    catalog: async () => {
      fetches += 1;
      if (fail) throw new Error("composio down");
      return [{ slug: "gmail", name: "Gmail", logo: null, description: null, categories: [], noAuth: false }];
    },
  });

  await h.integrations.catalog();
  await h.integrations.catalog();
  assert.equal(fetches, 1);

  h.advance(61 * 60 * 1000);
  fail = true;
  const stale = await h.integrations.catalog();
  assert.equal(stale[0]?.slug, "gmail");
  assert.equal(fetches, 2);

  const cold = harness({ catalog: async () => { throw new Error("down"); } });
  await assert.rejects(cold.integrations.catalog(), UpstreamUnavailableError);
});
