import { test } from "node:test";
import assert from "node:assert/strict";
import { PortExhaustedError } from "../src/domain/errors.js";
import { PortAllocator } from "../src/services/port-allocator.js";

function allocator(used: number[], start = 19000, end = 19004) {
  const repo = { getActiveGatewayPorts: async () => used };
  return new PortAllocator(repo as never, start, end);
}

test("concurrent allocations on one host get different ports", async () => {
  const ports = allocator([19000]);
  const got = await Promise.all([ports.allocate("h"), ports.allocate("h"), ports.allocate("h")]);
  assert.deepEqual(got.sort(), [19001, 19002, 19003]);
});

test("a released port is handed out again; other hosts are independent", async () => {
  const ports = allocator([]);
  const first = await ports.allocate("h");
  ports.release("h", first);
  assert.equal(await ports.allocate("h"), first);
  assert.equal(await ports.allocate("other"), 19000);
});

test("ports held by allocations in flight count towards exhaustion", async () => {
  const ports = allocator([19000, 19001, 19002], 19000, 19003);
  assert.equal(await ports.allocate("h"), 19003);
  await assert.rejects(ports.allocate("h"), PortExhaustedError);
});

test("a port released while a lookup is in flight is not handed out from that lookup's stale read", async () => {
  let answer: (ports: number[]) => void = () => undefined;
  let calls = 0;
  const repo = {
    getActiveGatewayPorts: () => {
      calls += 1;
      return calls === 1 ? Promise.resolve([]) : new Promise<number[]>((resolve) => (answer = resolve));
    },
  };
  const ports = new PortAllocator(repo as never, 19000, 19004);
  assert.equal(await ports.allocate("h"), 19000);
  const second = ports.allocate("h");
  ports.release("h", 19000);
  answer([]);
  assert.equal(await second, 19001);
});
