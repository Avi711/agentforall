import { test } from "node:test";
import assert from "node:assert/strict";
import { MetaGraphOAuth, MetaOAuthError } from "../../src/lib/whatsapp-cloud/meta-oauth";
import { WhatsappCloudConnectBodySchema } from "../../src/lib/whatsapp-cloud/schemas";
import { WhatsappCloudService, type WhatsappCloudConnectInput } from "../../src/lib/whatsapp-cloud/service";

function fakeFetch(responses: Array<{ status: number; body: string }>) {
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    urls.push(String(input));
    const next = responses.shift() ?? { status: 500, body: "" };
    return new Response(next.body, { status: next.status });
  }) as typeof fetch;
  return { urls, fetchImpl };
}

test("the code exchange calls Meta with the app credentials and returns the business token", async () => {
  const { urls, fetchImpl } = fakeFetch([{ status: 200, body: JSON.stringify({ access_token: "biz-token" }) }]);
  const oauth = new MetaGraphOAuth("app-1", "s3cret", "v24.0", fetchImpl);

  assert.equal(await oauth.exchangeCode("code-1"), "biz-token");
  assert.equal(urls[0], "https://graph.facebook.com/v24.0/oauth/access_token?client_id=app-1&client_secret=s3cret&code=code-1");
});

test("a rejected code fails at once, without a retry, and never echoes the secret", async () => {
  const { urls, fetchImpl } = fakeFetch([
    { status: 400, body: JSON.stringify({ error: { message: "bad code s3cret", code: 100 } }) },
    { status: 200, body: JSON.stringify({ access_token: "never" }) },
  ]);
  const oauth = new MetaGraphOAuth("app-1", "s3cret", "v24.0", fetchImpl);

  await assert.rejects(oauth.exchangeCode("code-1"), (err: unknown) => {
    assert.ok(err instanceof MetaOAuthError);
    assert.equal(err.status, 400);
    assert.equal(err.code, 100);
    assert.equal(err.message.includes("s3cret"), false);
    return true;
  });
  assert.equal(urls.length, 1);
});

test("a transient Meta failure is retried once", async () => {
  const { urls, fetchImpl } = fakeFetch([
    { status: 503, body: "" },
    { status: 200, body: JSON.stringify({ access_token: "biz-token" }) },
  ]);
  const oauth = new MetaGraphOAuth("app-1", "s3cret", "v24.0", fetchImpl);

  assert.equal(await oauth.exchangeCode("code-1"), "biz-token");
  assert.equal(urls.length, 2);
});

test("the connect body only accepts Meta ids, a code and an optional six-digit pin", () => {
  assert.equal(WhatsappCloudConnectBodySchema.safeParse({ code: "c", phoneNumberId: "1", wabaId: "2", businessId: "3", pin: "123456" }).success, true);
  assert.equal(WhatsappCloudConnectBodySchema.safeParse({ code: "c", phoneNumberId: "1", wabaId: "2", businessId: "3", pin: "12345" }).success, false);

  const ok = WhatsappCloudConnectBodySchema.safeParse({ code: "abc", phoneNumberId: "2000", wabaId: "1000", businessId: "3000" });
  assert.equal(ok.success, true);
  const bad = WhatsappCloudConnectBodySchema.safeParse({ code: "abc", phoneNumberId: "+972", wabaId: "1000", businessId: "3000" });
  assert.equal(bad.success, false);
  const extra = WhatsappCloudConnectBodySchema.safeParse({ code: "abc", phoneNumberId: "2000", wabaId: "1000", businessId: "3000", accessToken: "x" });
  assert.equal(extra.success, false);
});

test("a 2xx Meta cannot be read is reported as Meta's fault, and the single-use code is not spent on a retry", async () => {
  const { urls, fetchImpl } = fakeFetch([
    { status: 200, body: "<html>maintenance</html>" },
    { status: 200, body: JSON.stringify({ access_token: "never" }) },
  ]);
  const oauth = new MetaGraphOAuth("app-1", "s3cret", "v24.0", fetchImpl);

  await assert.rejects(oauth.exchangeCode("code-1"), (err: unknown) => {
    assert.ok(err instanceof MetaOAuthError);
    assert.equal(err.status, 200);
    return true;
  });
  assert.equal(urls.length, 1);
});

test("the connect body needs the number and the business unless the number stays in the WhatsApp Business app, which never takes a PIN", () => {
  const base = { code: "c", wabaId: "1000" };
  assert.equal(WhatsappCloudConnectBodySchema.safeParse({ ...base, phoneNumberId: "2000", businessId: "3000" }).success, true);
  assert.equal(WhatsappCloudConnectBodySchema.safeParse(base).success, false);
  assert.equal(WhatsappCloudConnectBodySchema.safeParse({ ...base, phoneNumberId: "2000" }).success, false);
  assert.equal(WhatsappCloudConnectBodySchema.safeParse({ ...base, coexistence: true }).success, true);
  assert.equal(WhatsappCloudConnectBodySchema.safeParse({ ...base, coexistence: true, phoneNumberId: "2000", businessId: "3000" }).success, true);
  assert.equal(WhatsappCloudConnectBodySchema.safeParse({ ...base, coexistence: true, pin: "123456" }).success, false);
});

test("the service hands the WhatsApp Business app flag and whatever ids Meta gave straight to the orchestrator", async () => {
  const calls: WhatsappCloudConnectInput[] = [];
  const view = { status: "connected" as const, phoneNumberId: "2000", wabaId: "1000", displayPhoneNumber: "+972501112233", verifiedName: "Shop", health: "ok" as const, syncPending: false };
  const port = {
    connectWhatsappCloud: async (_userId: string, _botId: string, input: WhatsappCloudConnectInput) => {
      calls.push(input);
      return view;
    },
    getWhatsappCloudStatus: async () => view,
    disconnectWhatsappCloud: async () => {},
  };
  const service = new WhatsappCloudService(port, { exchangeCode: async () => "biz-token" }, () => true);

  await service.connect("user-1", "bot-1", { code: "c", wabaId: "1000", coexistence: true });

  assert.deepEqual(calls, [{ accessToken: "biz-token", wabaId: "1000", coexistence: true }]);
});

test("a status from an orchestrator that predates the sync field reads as nothing pending", async () => {
  const { WhatsappCloudViewSchema } = await import("../../src/lib/orchestrator/types");
  const view = WhatsappCloudViewSchema.parse({ status: "connected", phoneNumberId: "2000", wabaId: "1000", displayPhoneNumber: "+972501112233", verifiedName: "Shop", health: "ok" });

  assert.equal(view.syncPending, false);
});
