import { z } from "zod";
import type { ContainerRuntime } from "../../container-runtime.js";
import type { BrowserTabsClosed } from "../types.js";

const CLI_TIMEOUT_MS = 30_000;
const EXEC_GRACE_MS = 5_000;
const MAX_STDOUT_BYTES = 256 * 1024;

// `openclaw browser tabs --json`; a bot whose browser is not running answers with no tabs.
const TabsOutput = z.object({
  tabs: z.array(z.object({ targetId: z.string(), type: z.string().optional() })),
});

export function parseOpenTabs(stdout: string): string[] {
  return TabsOutput.parse(JSON.parse(stdout))
    .tabs.filter((tab) => (tab.type ?? "page") === "page")
    .map((tab) => tab.targetId);
}

export async function closeOpenclawBrowserTabs(runtime: ContainerRuntime, containerId: string): Promise<BrowserTabsClosed> {
  const listed = await browserCli(runtime, containerId, ["tabs", "--json"]);
  if (listed.exitCode !== 0) throw new Error(listed.stderr || `openclaw browser tabs exited ${listed.exitCode}`);
  const result: BrowserTabsClosed = { closed: 0, failed: 0 };
  for (const targetId of parseOpenTabs(listed.stdout.toString("utf8"))) {
    if (await closeTab(runtime, containerId, targetId)) result.closed += 1;
    else result.failed += 1;
  }
  return result;
}

async function closeTab(runtime: ContainerRuntime, containerId: string, targetId: string): Promise<boolean> {
  try {
    return (await browserCli(runtime, containerId, ["close", targetId])).exitCode === 0;
  } catch {
    // Counted as failed by the caller; the next sweep tries the tab again.
    return false;
  }
}

function browserCli(runtime: ContainerRuntime, containerId: string, args: string[]) {
  return runtime.execCommandBuffer(
    containerId,
    ["openclaw", "browser", "--timeout", String(CLI_TIMEOUT_MS), ...args],
    CLI_TIMEOUT_MS + EXEC_GRACE_MS,
    MAX_STDOUT_BYTES,
  );
}
