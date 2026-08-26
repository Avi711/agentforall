import { test } from "node:test";
import assert from "node:assert/strict";
import { IntegrationsService, type IntegrationsPort } from "../../src/lib/integrations/service";

function fakePort() {
  const calls: { connect?: { app: string; returnUrl: string }; disconnect?: string } = {};
  const port: IntegrationsPort = {
    listIntegrationCatalog: async () => [],
    listIntegrations: async () => [],
    connectIntegration: async (_u, _b, app, returnUrl) => {
      calls.connect = { app, returnUrl };
      return { url: "https://connect.example/x", ref: "ref-1" };
    },
    disconnectIntegration: async (_u, _b, ref) => {
      calls.disconnect = ref;
    },
  };
  return { port, calls };
}

test("connect builds the return url from the app url, never from the browser", async () => {
  const { port, calls } = fakePort();
  const service = new IntegrationsService(port, "https://agentforall.co.il");

  const link = await service.connect("user-1", "bot-1", "gmail");

  assert.equal(link.url, "https://connect.example/x");
  assert.deepEqual(calls.connect, {
    app: "gmail",
    returnUrl: "https://agentforall.co.il/app/bot/connections?connected=gmail",
  });
});

test("return url survives an app url with a trailing path and encodes the slug", () => {
  const service = new IntegrationsService(fakePort().port, "http://localhost:3000");
  assert.equal(
    service.returnUrl("google_calendar"),
    "http://localhost:3000/app/bot/connections?connected=google_calendar",
  );
});

test("disconnect forwards the ref untouched", async () => {
  const { port, calls } = fakePort();
  await new IntegrationsService(port, "https://agentforall.co.il").disconnect("u", "b", "ca_9");
  assert.equal(calls.disconnect, "ca_9");
});
