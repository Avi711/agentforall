import { test } from "node:test";
import assert from "node:assert/strict";
import { MetaGraphOAuth, MetaOAuthError } from "../../src/lib/whatsapp-cloud/meta-oauth";
import { WhatsappCloudConnectBodySchema } from "../../src/lib/whatsapp-cloud/schemas";

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
