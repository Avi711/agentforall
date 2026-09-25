import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExecBufferResult } from "../src/services/container-runtime.js";
import { closeOpenclawBrowserTabs, parseOpenTabs } from "../src/services/agent-runtime/openclaw/browser.js";

function fakeRuntime(respond: (cmd: string[]) => ExecBufferResult) {
  const calls: Array<{ cmd: string[]; timeoutMs: number }> = [];
  const runtime = {
    execCommandBuffer: async (_containerId: string, cmd: string[], timeoutMs: number) => {
      calls.push({ cmd, timeoutMs });
      return respond(cmd);
    },
  };
  return { runtime: runtime as never, calls };
}

const ok = (stdout: string): ExecBufferResult => ({ exitCode: 0, stdout: Buffer.from(stdout), stderr: "" });
const TABS = JSON.stringify({
  tabs: [
    { targetId: "T1", tabId: "t1", type: "page", url: "https://a.example" },
    { targetId: "SW", tabId: "sw", type: "service_worker", url: "https://a.example/sw.js" },
    { targetId: "T2", tabId: "t2", type: "page", url: "https://b.example" },
  ],
});

test("only pages are closed (a tab without a type counts as a page); a browser that is not running lists no tabs", () => {
  assert.deepEqual(parseOpenTabs(TABS), ["T1", "T2"]);
  assert.deepEqual(parseOpenTabs(JSON.stringify({ tabs: [{ targetId: "T3" }] })), ["T3"]);
  assert.deepEqual(parseOpenTabs('{\n  "tabs": []\n}'), []);
});

test("closes every page with the CLI's own timeout and counts a tab that could not be closed", async () => {
  const { runtime, calls } = fakeRuntime((cmd) => {
    if (cmd.includes("tabs")) return ok(TABS);
    if (cmd.includes("T2")) return { exitCode: 1, stdout: Buffer.alloc(0), stderr: "tab not found" };
    return ok("closed tab");
  });
  assert.deepEqual(await closeOpenclawBrowserTabs(runtime, "c-1"), { closed: 1, failed: 1 });
  assert.deepEqual(
    calls.map((c) => c.cmd),
    [
      ["openclaw", "browser", "--timeout", "30000", "tabs", "--json"],
      ["openclaw", "browser", "--timeout", "30000", "close", "T1"],
      ["openclaw", "browser", "--timeout", "30000", "close", "T2"],
    ],
  );
  assert.ok(calls.every((c) => c.timeoutMs > 30_000), "the exec outlives the CLI's own timeout");
});

test("a failed tab listing is an error, not zero tabs", async () => {
  const { runtime } = fakeRuntime(() => ({ exitCode: 1, stdout: Buffer.alloc(0), stderr: "gateway down" }));
  await assert.rejects(closeOpenclawBrowserTabs(runtime, "c-1"), /gateway down/);
});

test("a close that throws counts as failed and the other tabs are still closed", async () => {
  const { runtime } = fakeRuntime((cmd) => {
    if (cmd.includes("tabs")) return ok(TABS);
    if (cmd.includes("T1")) throw new Error("exec timed out");
    return ok("closed tab");
  });
  assert.deepEqual(await closeOpenclawBrowserTabs(runtime, "c-1"), { closed: 1, failed: 1 });
});
