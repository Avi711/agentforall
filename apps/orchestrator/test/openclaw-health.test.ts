import { test } from "node:test";
import assert from "node:assert/strict";
import { probeOpenclawGateway } from "../src/services/agent-runtime/openclaw/health.js";

const BASE_URL = "http://openclaw-abc:18789";

// /readyz turned channel-aware in 2026.8 (503 while a channel is unlinked), which would have
// flagged every unpaired bot as degraded; /startupz reports only the gateway's own state.
test("degraded follows /startupz, and an older gateway without it yields no signal", async () => {
  for (const [startup, degraded] of [
    [200, false],
    [503, true],
    [404, null],
  ] as const) {
    await withFetch({ "/healthz": 200, "/startupz": startup }, async () => {
      assert.deepEqual(await probeOpenclawGateway(BASE_URL, 100), { healthy: true, degraded });
    });
  }
});

test("a gateway that fails liveness is unhealthy regardless of startup state", async () => {
  await withFetch({ "/healthz": 500, "/startupz": 200 }, async () => {
    assert.deepEqual(await probeOpenclawGateway(BASE_URL, 100), { healthy: false, degraded: null });
  });
  await withFetch({}, async () => {
    assert.deepEqual(await probeOpenclawGateway(BASE_URL, 100), { healthy: false, degraded: null });
  });
});

async function withFetch(routes: Record<string, number>, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    assert.ok(String(input).startsWith(BASE_URL));
    const path = new URL(String(input)).pathname;
    const status = routes[path];
    if (status === undefined) throw new Error("connection refused");
    return new Response(null, { status });
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}
