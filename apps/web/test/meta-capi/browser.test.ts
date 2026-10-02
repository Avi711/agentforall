import { test } from "node:test";
import assert from "node:assert/strict";
import { browserIdsFrom } from "../../src/lib/meta-capi/browser";

const NOW = 1_790_000_000_000;
const FBP = "fb.1.1789990000000.1234567890";
const FBC = "fb.1.1789990000000.IwAR2abc_DEF-123";

test("reads Meta's cookies, the Vercel-attested client IP, the user agent and the country", () => {
  const ids = browserIdsFrom(
    new Headers({
      cookie: `session=abc; _fbp=${FBP}; _fbc=${FBC}`,
      "x-forwarded-for": "10.0.0.1, 2a02:6680:1100::1",
      "user-agent": "Mozilla/5.0",
      "x-vercel-ip-country": "IL",
    }),
    NOW,
  );

  assert.deepEqual(ids, { fbp: FBP, fbc: FBC, clientIp: "2a02:6680:1100::1", userAgent: "Mozilla/5.0", country: "il" });
});

test("without an _fbc cookie, an fbclid on the referring page becomes the click id", () => {
  const ids = browserIdsFrom(new Headers({ referer: "https://agentforall.co.il/login?fbclid=IwAR2abc" }), NOW);

  assert.equal(ids.fbc, `fb.1.${NOW}.IwAR2abc`);
});

test("hand-edited cookies and headers are dropped rather than sent to Meta", () => {
  const ids = browserIdsFrom(
    new Headers({ cookie: "_fbp=hello; _fbc=fb.1.x.y", "x-vercel-ip-country": "Israel", "user-agent": "" }),
    NOW,
  );

  assert.deepEqual(ids, { fbp: null, fbc: null, clientIp: null, userAgent: null, country: null });
});
