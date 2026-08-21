import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROVISIONING_EVENT_TYPES,
  provisioningStageOf,
} from "../src/domain/provisioning.js";

test("provisioning events map to stages in order", () => {
  assert.deepEqual(PROVISIONING_EVENT_TYPES.map(provisioningStageOf), [
    "reserved",
    "container_created",
    "backup_restored",
    "started",
    "running",
  ]);
  assert.equal(provisioningStageOf("provision.failed"), null);
  assert.equal(provisioningStageOf("telegram.linked"), null);
});
