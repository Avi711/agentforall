import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import {
  AccountLabelTakenError,
  AccountLimitReachedError,
  AuthenticationError,
  FeatureUnavailableError,
  InvalidStateError,
  NotFoundError,
  UpstreamUnavailableError,
  ValidationError,
} from "../src/domain/errors.js";
import {
  INTEGRATION_MAX_ACCOUNTS_PER_APP,
  type CatalogApp,
  type IntegrationConnection,
  type IntegrationSession,
} from "../src/domain/integrations.js";
import type { ConfigPatch, Instance } from "../src/domain/types.js";
import { IntegrationsManager } from "../src/services/integrations/manager.js";
import {
  LabelConflictError,
  SessionGoneError,
  type IntegrationProvider,
} from "../src/services/integrations/provider.js";
import { IntegrationSessions } from "../src/services/integrations/sessions.js";
import { relayBindingFor } from "../src/services/integrations/relay-binding.js";
import { makeInstance } from "./helpers/fixtures.js";

const RETURN_URL = "https://agentforall.co.il/app/bot/connections?connected=gmail";
const noLog = { info() {}, warn() {}, error() {} } as unknown as FastifyBaseLogger;

interface Overrides {
  instance?: Partial<Instance>;
  unbound?: boolean;
  linkFailures?: number;
  // Composio creates the account at link time; it stays pending until the owner finishes consent.
  linkStatus?: IntegrationConnection["status"];
  catalog?: () => Promise<CatalogApp[]>;
}

function harness(overrides: Overrides = {}) {
  let instance = makeInstance([{ type: "whatsapp" }], overrides.instance);
  if (!overrides.unbound && !instance.config.integrations) {
    instance = {
      ...instance,
      config: { ...instance.config, integrations: relayBindingFor(instance.id, "http://orchestrator:3000") },
    };
  }
  const calls = {
    createSession: 0,
    deleteSession: [] as string[],
    links: [] as { session: string; app: string; callbackUrl: string; label: string | undefined }[],
    revoked: [] as string[],
    renamed: [] as [string, string][],
    multiAccount: [] as string[],
    updateConfig: [] as ConfigPatch[],
    events: [] as string[],
    restarts: 0,
  };
  let connections: IntegrationConnection[] = [];
  let linkFailures = overrides.linkFailures ?? 0;
  let listError: Error | null = null;
  let revokeError: Error | null = null;
  let aliasConflict = false;

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
      if (aliasConflict && input.label) throw new LabelConflictError();
      calls.links.push({ session: input.providerSessionId, app: input.app, callbackUrl: input.callbackUrl, label: input.label });
      connections.push({
        ref: `ref-${calls.links.length}`,
        app: input.app,
        status: overrides.linkStatus ?? "active",
        label: input.label ?? null,
        createdAt: null,
      });
      return { url: `https://connect/${input.app}`, ref: `ref-${calls.links.length}` };
    },
    allowMultipleAccounts: async (id) => {
      calls.multiAccount.push(id);
    },
    renameConnection: async (ref, label) => {
      if (aliasConflict) throw new LabelConflictError();
      calls.renamed.push([ref, label]);
      connections = connections.map((c) => (c.ref === ref ? { ...c, label } : c));
    },
    listConnections: async () => {
      if (listError) throw listError;
      return connections;
    },
    revokeConnection: async (ref) => {
      if (revokeError) throw revokeError;
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
    restart: async () => {
      calls.restarts += 1;
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
    failRevokeWith: (err: Error) => {
      revokeError = err;
    },
    refuseAliases: () => {
      aliasConflict = true;
    },
    seed: (items: IntegrationConnection[]) => {
      connections = items;
    },
  };
}

test("first connect creates one session and returns the hosted link", async () => {
  const h = harness();
  const inst = h.instance();

  const [a, b] = await Promise.all([
    h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL }),
    h.integrations.connect(inst.id, inst.userId, { app: "notion", returnUrl: RETURN_URL }),
  ]);

  assert.equal(a.url, "https://connect/gmail");
  assert.equal(b.url, "https://connect/notion");
  assert.equal(h.calls.createSession, 1);
  // The relay was bound at creation; connect never touches the config or restarts the bot.
  assert.equal(h.calls.updateConfig.length, 0);
  assert.equal(h.calls.restarts, 0);
  assert.deepEqual(h.calls.links.map((l) => l.callbackUrl), [RETURN_URL, RETURN_URL]);
  assert.ok(h.calls.events.includes("integration.session_created"));
  assert.ok(h.calls.events.includes("integration.connect_requested"));
});

test("connect refuses a bot without a relay binding instead of binding it", async () => {
  const h = harness({ unbound: true });
  const inst = h.instance();

  await assert.rejects(
    () => h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL }),
    FeatureUnavailableError,
  );
  assert.equal(h.calls.updateConfig.length, 0);
  assert.equal(h.calls.restarts, 0);
});

test("a vanished upstream session is recreated once and the link still comes back", async () => {
  const h = harness({ linkFailures: 1 });
  const inst = h.instance();

  const link = await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL });

  assert.equal(link.url, "https://connect/gmail");
  assert.equal(h.calls.createSession, 2);
  assert.equal(h.rows.get(inst.id)?.providerSessionId, "sess-2");
  assert.equal(h.calls.links[0]?.session, "sess-2");
});

test("connect refuses foreign return urls and non-openclaw runtimes", async () => {
  const h = harness();
  const inst = h.instance();
  await assert.rejects(
    h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: "https://evil.example/cb" }),
    ValidationError,
  );

  const hermes = harness({ instance: { runtimeKind: "hermes" } });
  await assert.rejects(
    hermes.integrations.connect(hermes.instance().id, hermes.instance().userId, { app: "gmail", returnUrl: RETURN_URL }),
    FeatureUnavailableError,
  );
  assert.equal(h.calls.createSession + hermes.calls.createSession, 0);
});

test("connect refuses a bot that is being destroyed and creates nothing upstream", async () => {
  const h = harness({ instance: { status: "destroying" } });
  const inst = h.instance();
  await assert.rejects(h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL }), InvalidStateError);
  assert.equal(h.calls.createSession, 0);
});

test("provider failures reach callers as a bare upstream error without vendor detail", async () => {
  const h = harness();
  const inst = h.instance();
  await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL });
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

test("an unnamed reconnect replaces that app's unfinished unnamed attempts and leaves other apps alone", async () => {
  const h = harness();
  const inst = h.instance();
  h.seed([
    { ref: "old-expired", app: "gmail", status: "expired", label: null, createdAt: "2026-08-01T00:00:00.000Z" },
    { ref: "old-failed", app: "gmail", status: "failed", label: null, createdAt: "2026-08-02T00:00:00.000Z" },
    { ref: "abandoned", app: "gmail", status: "pending", label: null, createdAt: "2026-08-03T00:00:00.000Z" },
    { ref: "other-app", app: "notion", status: "expired", label: null, createdAt: "2026-08-04T00:00:00.000Z" },
  ]);

  await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL });

  assert.deepEqual(h.calls.revoked.sort(), ["abandoned", "old-expired", "old-failed"]);
});

test("a failing revoke does not block the connect", async () => {
  const h = harness();
  const inst = h.instance();
  h.seed([{ ref: "old-expired", app: "gmail", status: "expired", label: null, createdAt: null }]);
  h.failRevokeWith(new Error("composio 500"));

  const link = await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL });
  assert.equal(link.url, "https://connect/gmail");
});

test("an attempt that cannot be replaced is an outage, never the owner's name clash or full cap", async () => {
  const h = harness();
  const inst = h.instance();
  h.seed([
    { ref: "work", app: "gmail", status: "active", label: "עבודה", createdAt: null },
    { ref: "home-pending", app: "gmail", status: "pending", label: "אישי", createdAt: null },
  ]);
  h.failRevokeWith(new Error("composio 500"));

  await assert.rejects(
    h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL, label: "אישי" }),
    UpstreamUnavailableError,
  );
  assert.equal(h.calls.links.length, 0);

  h.seed([
    { ref: "a", app: "gmail", status: "active", label: "a", createdAt: null },
    { ref: "b", app: "gmail", status: "active", label: "b", createdAt: null },
    { ref: "dead", app: "gmail", status: "expired", label: null, createdAt: null },
  ]);
  await assert.rejects(
    h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL, label: "c" }),
    UpstreamUnavailableError,
  );
  await assert.rejects(
    h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL, label: "a" }),
    AccountLabelTakenError,
    "a name a live account holds is still the owner's clash",
  );
});

test("a name the provider refuses as a duplicate reaches the owner as a taken name", async () => {
  const h = harness();
  const inst = h.instance();
  h.seed([{ ref: "work", app: "gmail", status: "active", label: null, createdAt: null }]);
  h.refuseAliases();

  await assert.rejects(
    h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL, label: "אישי" }),
    AccountLabelTakenError,
  );
  await assert.rejects(h.integrations.rename(inst.id, inst.userId, "work", "עבודה"), AccountLabelTakenError);
});

test("a failing account lookup does not block the connect, and still readies the session for another account", async () => {
  const h = harness();
  const inst = h.instance();
  h.failListWith(new Error("composio 502"));

  const link = await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL });
  assert.equal(link.url, "https://connect/gmail");
  assert.deepEqual(h.calls.revoked, []);
  assert.deepEqual(h.calls.multiAccount, ["sess-1"]);
});

test("a second account connects under its own label once the session allows several", async () => {
  const h = harness();
  const inst = h.instance();

  await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL, label: "עבודה" });
  assert.deepEqual(h.calls.multiAccount, [], "a first account needs nothing from the session");
  await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL, label: "אישי" });

  assert.deepEqual(h.calls.multiAccount, ["sess-1"]);
  assert.deepEqual(h.calls.links.map((l) => l.label), ["עבודה", "אישי"]);
  const labels = (await h.integrations.list(inst.id, inst.userId)).map((c) => c.label);
  assert.deepEqual(labels.sort(), ["אישי", "עבודה"]);
});

test("retrying under the same name replaces the abandoned attempt instead of refusing the name", async () => {
  const h = harness({ linkStatus: "pending" });
  const inst = h.instance();
  h.seed([{ ref: "work", app: "gmail", status: "active", label: "עבודה", createdAt: null }]);

  await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL, label: "אישי" });
  await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL, label: "אישי" });
  await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL, label: "אישי" });

  assert.deepEqual(h.calls.revoked, ["ref-1", "ref-2"]);
  const accounts = await h.integrations.list(inst.id, inst.userId);
  assert.deepEqual(accounts.map((c) => c.ref).sort(), ["ref-3", "work"]);
});

test("repeated unnamed attempts never pile up against the cap", async () => {
  const h = harness({ linkStatus: "pending" });
  const inst = h.instance();

  for (let i = 0; i < INTEGRATION_MAX_ACCOUNTS_PER_APP + 2; i += 1) {
    await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL });
  }
  assert.equal((await h.integrations.list(inst.id, inst.userId)).length, 1);
});

test("another account's named dead record survives a connect, so its owner still sees it", async () => {
  const h = harness();
  const inst = h.instance();
  h.seed([{ ref: "work-dead", app: "gmail", status: "expired", label: "עבודה", createdAt: null }]);

  await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL, label: "אישי" });

  assert.deepEqual(h.calls.revoked, []);
  await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL, label: "עבודה" });
  assert.deepEqual(h.calls.revoked, ["work-dead"], "reconnecting under its own name replaces it");
});

test("a name already used by a live account of that app is refused, however it is cased or composed", async () => {
  const h = harness();
  const inst = h.instance();
  h.seed([
    { ref: "work", app: "gmail", status: "active", label: "Work", createdAt: null },
    { ref: "home", app: "gmail", status: "active", label: "e\u0301cole", createdAt: null },
    { ref: "other-app", app: "notion", status: "active", label: "home", createdAt: null },
  ]);

  for (const label of ["work", " WORK ", "école"]) {
    await assert.rejects(
      h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL, label }),
      AccountLabelTakenError,
      label,
    );
  }
  assert.equal(h.calls.links.length, 0);
  await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL, label: "home" });
  assert.deepEqual(h.calls.links.map((l) => l.label), ["home"]);
});

test("an app at its account cap refuses another; pending counts, dead unnamed attempts do not", async () => {
  const h = harness();
  const inst = h.instance();
  const live: IntegrationConnection[] = Array.from({ length: INTEGRATION_MAX_ACCOUNTS_PER_APP }, (_, i) => ({
    ref: `live-${i}`,
    app: "gmail",
    status: i === 0 ? "pending" : "active",
    label: `account ${i}`,
    createdAt: null,
  }));
  h.seed(live);

  await assert.rejects(
    h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL, label: "new" }),
    AccountLimitReachedError,
  );
  assert.equal(h.calls.links.length, 0);

  h.seed([...live.slice(1), { ref: "dead", app: "gmail", status: "expired", label: null, createdAt: null }]);
  await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL, label: "new" });
  assert.deepEqual(h.calls.revoked, ["dead"]);
  assert.equal(h.calls.links.length, 1);
});

test("a session gone again straight after its recreate surfaces as an outage, not a crash", async () => {
  const h = harness({ linkFailures: 2 });
  const inst = h.instance();

  await assert.rejects(
    h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL }),
    UpstreamUnavailableError,
  );
  assert.equal(h.calls.createSession, 2);
});

test("rename sets the label of the bot's own account and refuses a name its sibling holds", async () => {
  const h = harness();
  const inst = h.instance();
  await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL });
  await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL, label: "אישי" });
  await h.integrations.connect(inst.id, inst.userId, { app: "notion", returnUrl: RETURN_URL, label: "עבודה" });

  await h.integrations.rename(inst.id, inst.userId, "ref-1", "עבודה");
  await assert.rejects(h.integrations.rename(inst.id, inst.userId, "ref-1", "אישי"), AccountLabelTakenError);
  await assert.rejects(h.integrations.rename(inst.id, inst.userId, "ref-other", "x"), NotFoundError);
  await h.integrations.rename(inst.id, inst.userId, "ref-2", "אישי");

  const labels = Object.fromEntries((await h.integrations.list(inst.id, inst.userId)).map((c) => [c.ref, c.label]));
  assert.deepEqual(labels, { "ref-1": "עבודה", "ref-2": "אישי", "ref-3": "עבודה" });
  assert.deepEqual(h.calls.renamed, [
    ["ref-1", "עבודה"],
    ["ref-2", "אישי"],
  ]);
  assert.ok(h.calls.events.includes("integration.renamed"));
});

test("rename refuses a bot that is being destroyed", async () => {
  const h = harness({ instance: { status: "destroying" } });
  const inst = h.instance();
  await assert.rejects(h.integrations.rename(inst.id, inst.userId, "ref-1", "עבודה"), InvalidStateError);
  assert.deepEqual(h.calls.renamed, []);
});

test("list returns newest connections first so a retry outranks the attempt it replaces", async () => {
  const h = harness();
  const inst = h.instance();
  await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL });
  h.seed([
    { ref: "older", app: "gmail", status: "expired", label: null, createdAt: "2026-08-01T00:00:00.000Z" },
    { ref: "undated", app: "gmail", status: "expired", label: null, createdAt: null },
    { ref: "newer", app: "gmail", status: "active", label: null, createdAt: "2026-08-02T00:00:00.000Z" },
  ]);

  const refs = (await h.integrations.list(inst.id, inst.userId)).map((c) => c.ref);
  assert.deepEqual(refs, ["newer", "older", "undated"]);
});

test("disconnect only revokes refs that belong to the bot", async () => {
  const h = harness();
  const inst = h.instance();
  await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL });

  await assert.rejects(h.integrations.disconnect(inst.id, inst.userId, "ref-other"), NotFoundError);
  await h.integrations.disconnect(inst.id, inst.userId, "ref-1");

  assert.deepEqual(h.calls.revoked, ["ref-1"]);
  assert.ok(h.calls.events.includes("integration.disconnected"));
});

test("resolveRelay accepts only the bound token of a live bot", async () => {
  const h = harness();
  const inst = h.instance();
  await assert.rejects(h.integrations.resolveRelay(inst.id, "anything"), AuthenticationError);

  await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL });
  const token = h.instance().config.integrations?.relayToken ?? "";

  const target = await h.integrations.resolveRelay(inst.id, token);
  assert.deepEqual(target, { upstreamUrl: "https://mcp/1", headers: { "x-api-key": "project-key" } });
  await assert.rejects(h.integrations.resolveRelay(inst.id, `${token}x`), AuthenticationError);
  await assert.rejects(h.integrations.resolveRelay("22222222-2222-4222-8222-222222222222", token), AuthenticationError);
});

// The relay is bound at creation now, so the first thing a bot's container ever does may be a
// relay call: the provider session is created then, once, however many calls race for it.
test("resolveRelay creates the provider session on a bot's first call and shares it", async () => {
  const binding = { relayToken: "a".repeat(64), relayUrl: "http://orchestrator:3000/api/v1/mcp/x" };
  const h = harness({ instance: { config: { ...makeInstance([]).config, integrations: binding } } });
  const inst = h.instance();

  const targets = await Promise.all([
    h.integrations.resolveRelay(inst.id, binding.relayToken),
    h.integrations.resolveRelay(inst.id, binding.relayToken),
  ]);

  assert.equal(h.calls.createSession, 1);
  assert.deepEqual(targets, [
    { upstreamUrl: "https://mcp/1", headers: { "x-api-key": "project-key" } },
    { upstreamUrl: "https://mcp/1", headers: { "x-api-key": "project-key" } },
  ]);
  assert.ok(h.calls.events.includes("integration.session_created"));
  // A later dashboard connect reuses the session the relay created.
  await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL });
  assert.equal(h.calls.createSession, 1);
  assert.equal(h.calls.updateConfig.length, 0);
});

test("resolveRelay refuses a bot that is being destroyed", async () => {
  const h = harness();
  const inst = h.instance();
  await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL });
  const token = h.instance().config.integrations?.relayToken ?? "";
  const destroying = harness({ instance: { status: "destroying", config: h.instance().config } });
  await destroying.sessions.ensure(inst.id, "https://agentforall.co.il/app/bot/connections");

  await assert.rejects(destroying.integrations.resolveRelay(inst.id, token), AuthenticationError);
});

test("revokeAll drops every connection, the upstream session, and our row", async () => {
  const h = harness();
  const inst = h.instance();
  await h.integrations.connect(inst.id, inst.userId, { app: "gmail", returnUrl: RETURN_URL });
  await h.integrations.connect(inst.id, inst.userId, { app: "notion", returnUrl: RETURN_URL });

  await h.sessions.revokeAll(h.instance());

  assert.deepEqual(h.calls.revoked, ["ref-1", "ref-2"]);
  assert.deepEqual(h.calls.deleteSession, ["sess-1"]);
  assert.equal(h.rows.has(inst.id), false);
  assert.ok(h.calls.events.includes("integration.revoked_all"));
});

const HOUR_MS = 60 * 60 * 1000;

// Refilling the catalog takes ~9s against Composio, so it is held for a day and refreshed behind a
// served answer. The one case that may block is a cold process with nothing to serve.
test("catalog is cached for a day and served stale when the provider fails", async () => {
  let fetches = 0;
  let fail = false;
  const h = harness({
    catalog: async () => {
      fetches += 1;
      if (fail) throw new Error("composio down");
      return [{ slug: "gmail", name: "Gmail", logo: null, description: null, categories: [], noAuth: false }];
    },
  });

  await h.integrations.catalog({ limit: 100, offset: 0 });
  await h.integrations.catalog({ limit: 100, offset: 0 });
  assert.equal(fetches, 1);

  // Still inside the day, before the refresh window: nothing is fetched.
  h.advance(20 * HOUR_MS);
  await h.integrations.catalog({ limit: 100, offset: 0 });
  assert.equal(fetches, 1);

  const cold = harness({ catalog: async () => { throw new Error("down"); } });
  await assert.rejects(cold.integrations.catalog({ limit: 100, offset: 0 }), UpstreamUnavailableError);

  const stale = harness({
    catalog: async () => {
      fetches += 1;
      if (fail) throw new Error("composio down");
      return [{ slug: "gmail", name: "Gmail", logo: null, description: null, categories: [], noAuth: false }];
    },
  });
  await stale.integrations.catalog({ limit: 100, offset: 0 });
  stale.advance(25 * HOUR_MS);
  fail = true;
  const served = await stale.integrations.catalog({ limit: 100, offset: 0 });
  assert.equal(served.apps[0]?.slug, "gmail", "an expired catalog still answers from the last good list");
});

// The refresh window exists so the day-old list is replaced without anyone waiting for it.
test("a catalog inside its refresh window answers immediately and refills behind the answer", async () => {
  let fetches = 0;
  const pending: (() => void)[] = [];
  const h = harness({
    catalog: async () => {
      fetches += 1;
      if (fetches > 1) await new Promise<void>((resolve) => pending.push(resolve));
      return [{ slug: "gmail", name: "Gmail", logo: null, description: null, categories: [], noAuth: false }];
    },
  });

  await h.integrations.catalog({ limit: 100, offset: 0 });
  h.advance(23 * HOUR_MS);

  const answered = await h.integrations.catalog({ limit: 100, offset: 0 });
  assert.equal(answered.apps[0]?.slug, "gmail", "answered from the stale list, not the pending refresh");
  assert.equal(fetches, 2, "a refresh was started behind the answer");
  for (const resolve of pending) resolve();
});

// A failed refresh must not age the list — otherwise one blip near the TTL freezes it for a day —
// and must not retry on every read while the provider is down.
test("a failed background refresh keeps the list's real age and backs off", async () => {
  let fetches = 0;
  let fail = false;
  const h = harness({
    catalog: async () => {
      fetches += 1;
      if (fail) throw new Error("composio down");
      return [{ slug: "gmail", name: "Gmail", logo: null, description: null, categories: [], noAuth: false }];
    },
  });

  await h.integrations.catalog({ limit: 100, offset: 0 });
  h.advance(23 * HOUR_MS);
  fail = true;
  await h.integrations.catalog({ limit: 100, offset: 0 });
  assert.equal(fetches, 2, "the refresh was attempted");

  // Straight after the failure: served from the list, no second attempt.
  const served = await h.integrations.catalog({ limit: 100, offset: 0 });
  assert.equal(served.apps[0]?.slug, "gmail");
  assert.equal(fetches, 2, "a provider that is down is not hammered on every read");

  // Once the backoff has passed it tries again, and succeeds.
  h.advance(6 * 60 * 1000);
  fail = false;
  await h.integrations.catalog({ limit: 100, offset: 0 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetches, 3, "the refresh is retried after the backoff, not a day later");
});

// Past the TTL the stale list is all there is, so re-attempting on every read only spends the
// client's ~33s retry budget to hand back the same list.
test("a provider that is down is not re-attempted on every read past the TTL", async () => {
  let fetches = 0;
  let fail = false;
  const h = harness({
    catalog: async () => {
      fetches += 1;
      if (fail) throw new Error("composio down");
      return [{ slug: "gmail", name: "Gmail", logo: null, description: null, categories: [], noAuth: false }];
    },
  });

  await h.integrations.catalog({ limit: 100, offset: 0 });
  h.advance(25 * HOUR_MS);
  fail = true;
  const first = await h.integrations.catalog({ limit: 100, offset: 0 });
  assert.equal(first.apps[0]?.slug, "gmail", "the last good list is still served");
  assert.equal(fetches, 2, "one attempt past the TTL");

  for (let i = 0; i < 3; i += 1) await h.integrations.catalog({ limit: 100, offset: 0 });
  assert.equal(fetches, 2, "no further attempts inside the backoff");

  h.advance(6 * 60 * 1000);
  fail = false;
  await h.integrations.catalog({ limit: 100, offset: 0 });
  assert.equal(fetches, 3, "the next read past the backoff refreshes");
});

// A provider that answers with an empty list would otherwise blank every tile for a day.
test("an empty refresh keeps the last good list", async () => {
  let apps = [{ slug: "gmail", name: "Gmail", logo: null, description: null, categories: [], noAuth: false }];
  const h = harness({ catalog: async () => apps });

  await h.integrations.catalog({ limit: 100, offset: 0 });
  h.advance(25 * HOUR_MS);
  apps = [];
  const served = await h.integrations.catalog({ limit: 100, offset: 0 });

  assert.equal(served.apps[0]?.slug, "gmail", "an empty answer never replaces the catalog");
  assert.equal(served.total, 1);
});

test("warmCatalog fills the cache before anyone asks, and survives a provider that is down", async () => {
  let fetches = 0;
  const h = harness({
    catalog: async () => {
      fetches += 1;
      return [{ slug: "gmail", name: "Gmail", logo: null, description: null, categories: [], noAuth: false }];
    },
  });

  h.integrations.warmCatalog();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetches, 1, "the warm-up fetched on its own, before any read");

  await h.integrations.catalog({ limit: 100, offset: 0 });
  assert.equal(fetches, 1, "the read was served from the warmed cache");

  // A warm-up against a down provider must record its attempt like any other, or the backoff below
  // has nothing to work from and the boot failure costs every later read a fresh ~33s wait.
  let downFetches = 0;
  let down = true;
  const cold = harness({
    catalog: async () => {
      downFetches += 1;
      if (down) throw new Error("composio down");
      return [{ slug: "gmail", name: "Gmail", logo: null, description: null, categories: [], noAuth: false }];
    },
  });
  cold.integrations.warmCatalog();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(downFetches, 1);

  await assert.rejects(cold.integrations.catalog({ limit: 100, offset: 0 }), UpstreamUnavailableError);
  assert.equal(downFetches, 1, "the failed warm-up backs the next read off instead of re-attempting");

  cold.advance(6 * 60 * 1000);
  down = false;
  const recovered = await cold.integrations.catalog({ limit: 100, offset: 0 });
  assert.equal(recovered.apps[0]?.slug, "gmail", "the catalog fills once the provider is back");
  assert.equal(downFetches, 2);
});

// The empty-list guard has to hold at boot too: warmCatalog makes the very first fetch the one with
// no earlier list behind it, and caching [] there would blank every tile for a day.
test("an empty first answer is not cached as a catalog", async () => {
  let fetches = 0;
  let apps: { slug: string; name: string; logo: null; description: null; categories: []; noAuth: boolean }[] = [];
  const h = harness({
    catalog: async () => {
      fetches += 1;
      return apps;
    },
  });

  h.integrations.warmCatalog();
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(h.integrations.catalog({ limit: 100, offset: 0 }), UpstreamUnavailableError);
  assert.equal(fetches, 1, "an empty answer is a failed attempt, so the backoff governs the retry");

  h.advance(6 * 60 * 1000);
  apps = [{ slug: "gmail", name: "Gmail", logo: null, description: null, categories: [], noAuth: false }];
  const filled = await h.integrations.catalog({ limit: 100, offset: 0 });
  assert.equal(filled.apps[0]?.slug, "gmail", "the retry comes minutes later, not a day later");
  assert.equal(fetches, 2);
});

// Sequential cold reads against a dead provider each pay the client's full ~33s retry budget unless
// the attempt is remembered.
test("a cold catalog fails fast while the provider stays down", async () => {
  let fetches = 0;
  const h = harness({
    catalog: async () => {
      fetches += 1;
      throw new Error("composio down");
    },
  });

  await assert.rejects(h.integrations.catalog({ limit: 100, offset: 0 }), UpstreamUnavailableError);
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(h.integrations.catalog({ limit: 100, offset: 0 }), UpstreamUnavailableError);
  }
  assert.equal(fetches, 1, "the provider is asked once per backoff, not once per read");

  h.advance(6 * 60 * 1000);
  await assert.rejects(h.integrations.catalog({ limit: 100, offset: 0 }), UpstreamUnavailableError);
  assert.equal(fetches, 2, "and is tried again once the backoff has passed");
});
