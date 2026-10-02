import { test } from "node:test";
import assert from "node:assert/strict";
import { metaPixelId, readCapiConfig } from "../../src/lib/meta-capi/config";

const PRODUCTION = { VERCEL_ENV: "production", NEXT_PUBLIC_META_PIXEL_ID: "803144279101703", META_CAPI_ACCESS_TOKEN: "token" };

test("the production deployment sends on the current Marketing API version", () => {
  assert.deepEqual(readCapiConfig(PRODUCTION), {
    pixelId: "803144279101703",
    accessToken: "token",
    apiVersion: "v26.0",
    testEventCode: undefined,
  });
  assert.equal(readCapiConfig({ ...PRODUCTION, META_CAPI_API_VERSION: "v27.0" })?.apiVersion, "v27.0");
});

test("previews and dev machines send only with a test event code", () => {
  assert.equal(readCapiConfig({ ...PRODUCTION, VERCEL_ENV: "preview" }), null);
  assert.equal(readCapiConfig({ ...PRODUCTION, VERCEL_ENV: undefined }), null);
  assert.equal(readCapiConfig({ ...PRODUCTION, VERCEL_ENV: undefined, META_CAPI_TEST_EVENT_CODE: "TEST123" })?.testEventCode, "TEST123");
});

test("nothing sends without a token or with a non-numeric pixel id", () => {
  assert.equal(readCapiConfig({ ...PRODUCTION, META_CAPI_ACCESS_TOKEN: "" }), null);
  assert.equal(readCapiConfig({ ...PRODUCTION, NEXT_PUBLIC_META_PIXEL_ID: "1');alert(1)//" }), null);
});

test("the Pixel loads only on the production deployment", () => {
  assert.equal(metaPixelId(PRODUCTION), "803144279101703");
  assert.equal(metaPixelId({ ...PRODUCTION, VERCEL_ENV: "preview" }), null);
  assert.equal(metaPixelId({ ...PRODUCTION, VERCEL_ENV: undefined }), null);
});
