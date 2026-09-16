import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeInstance } from "../src/routes/instances.js";
import { makeInstance } from "./helpers/fixtures.js";

test("the public view drops credentials and the move's bucket path", () => {
  const inst = makeInstance([{ type: "whatsapp" }], {
    movedFromHostId: "host-a",
    moveObjectName: "moves/4b86fc8b/2026-09-16T00:00:00.000Z.tar",
    movedAt: new Date(),
  });

  const view = sanitizeInstance(inst);

  assert.ok(!("gatewayToken" in view));
  assert.ok(!("moveObjectName" in view));
  assert.equal(view.movedFromHostId, "host-a");
  assert.equal((view.config as { provider: { apiKey: string } }).provider.apiKey, "***");
});
