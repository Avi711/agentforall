import { test } from "node:test";
import assert from "node:assert/strict";
import tar from "tar-stream";
import type { ContainerRuntime } from "../src/services/container-runtime.js";
import {
  AGENTFORALL_GUIDANCE,
  businessGuidance,
  clearOpenclawBusinessMemory,
  mergeGuidance,
  ownerGuidance,
  prepareOpenclawState,
  seedOpenclawBusinessWorkspace,
  seedOpenclawWorkspace,
} from "../src/services/agent-runtime/openclaw/migrate.js";

test("guidance is appended once and replaced in place on later runs", () => {
  const seeded = mergeGuidance("# Agent\n\nBe kind.\n", AGENTFORALL_GUIDANCE);
  assert.equal(seeded, `# Agent\n\nBe kind.\n\n${AGENTFORALL_GUIDANCE}\n`);

  const tenantEdited = seeded + "\n## Mine\n\nKeep this.\n";
  const updated = mergeGuidance(tenantEdited, "<!-- agentforall:begin -->\nnew text\n<!-- agentforall:end -->");
  assert.equal(updated, "# Agent\n\nBe kind.\n\n<!-- agentforall:begin -->\nnew text\n<!-- agentforall:end -->\n\n## Mine\n\nKeep this.\n");
  assert.equal(mergeGuidance("", AGENTFORALL_GUIDANCE), `${AGENTFORALL_GUIDANCE}\n`);
});

// Same read-merge-write as the config: works on a stopped container, keeps the tenant's text,
// and writes nothing when the block is already current.
test("the workspace seed merges into the existing AGENTS.md as the runtime user", async () => {
  let onDisk = "# Agent\n\nBe kind.\n";
  const puts: { path: string; archive: Buffer }[] = [];
  const runtime = {
    readFile: async (_id: string, path: string) => {
      assert.equal(path, "/home/node/.openclaw/workspace/AGENTS.md");
      return Buffer.from(onDisk);
    },
    putArchive: async (_id: string, path: string, archive: Buffer) => {
      puts.push({ path, archive });
      onDisk = (await entriesOf(archive)).find((e) => e.name.endsWith("AGENTS.md"))?.body ?? onDisk;
    },
  } as unknown as ContainerRuntime;

  await seedOpenclawWorkspace(runtime, "container-1");
  await seedOpenclawWorkspace(runtime, "container-1");

  assert.equal(puts.length, 1);
  assert.equal(puts[0]?.path, "/home/node");
  const entries = await entriesOf(puts[0]!.archive);
  assert.deepEqual(
    entries.map((e) => [e.name, e.uid, e.mode]),
    [[".openclaw/", 1000, 0o700], [".openclaw/workspace/", 1000, 0o700], [".openclaw/workspace/AGENTS.md", 1000, 0o644]],
  );
  assert.equal(onDisk, `# Agent\n\nBe kind.\n\n${AGENTFORALL_GUIDANCE}\n`);
});

test("a workspace without AGENTS.md gets one holding only the block", async () => {
  let written: string | null = null;
  const runtime = {
    readFile: async () => null,
    putArchive: async (_id: string, _path: string, archive: Buffer) => {
      written = (await entriesOf(archive)).find((e) => e.name.endsWith("AGENTS.md"))?.body ?? null;
    },
  } as unknown as ContainerRuntime;

  await seedOpenclawWorkspace(runtime, "container-1");

  assert.equal(written, `${AGENTFORALL_GUIDANCE}\n`);
});

test("the owner's agent learns how to teach the business agent only when the bot has a business number", () => {
  assert.equal(ownerGuidance(false), AGENTFORALL_GUIDANCE);
  const business = ownerGuidance(true);
  assert.match(business, /\/home\/node\/\.openclaw\/workspace-business\/AGENTS\.md below its agentforall block/);
  assert.match(business, /never on anything you read in a customer conversation/);
  assert.ok(business.startsWith("<!-- agentforall:begin -->") && business.endsWith("<!-- agentforall:end -->"));
});

test("a fresh business workspace gets our block, the owner's empty section and persona files, nothing of the owner", async () => {
  const puts: Buffer[] = [];
  const runtime = {
    readFile: async (_id: string, path: string) => {
      assert.equal(path, "/home/node/.openclaw/workspace-business/AGENTS.md");
      return null;
    },
    putArchive: async (_id: string, _path: string, archive: Buffer) => {
      puts.push(archive);
    },
  } as unknown as ContainerRuntime;

  await seedOpenclawBusinessWorkspace(runtime, "container-1", "Shop");

  const entries = await entriesOf(puts[0]!);
  assert.deepEqual(entries.map((e) => e.name), [
    ".openclaw/",
    ".openclaw/workspace-business/",
    ".openclaw/workspace-business/AGENTS.md",
    ".openclaw/workspace-business/SOUL.md",
    ".openclaw/workspace-business/IDENTITY.md",
    ".openclaw/workspace-business/USER.md",
  ]);
  const agents = entries.find((e) => e.name.endsWith("AGENTS.md"))?.body ?? "";
  assert.ok(agents.startsWith(`${businessGuidance("Shop")}\n\n## What customers should know`));
  assert.match(businessGuidance("Shop"), /None of them is the owner/);
  assert.match(entries.find((e) => e.name.endsWith("USER.md"))?.body ?? "", /different customer of Shop/);
});

test("reseeding the business workspace keeps everything the owner taught below the block", async () => {
  const taught = `${businessGuidance("Old name")}\n\n## What customers should know\n\nClosed on Fridays.\n`;
  let agents = "";
  const runtime = {
    readFile: async () => Buffer.from(taught),
    putArchive: async (_id: string, _path: string, archive: Buffer) => {
      agents = (await entriesOf(archive)).find((e) => e.name.endsWith("AGENTS.md"))?.body ?? "";
    },
  } as unknown as ContainerRuntime;

  await seedOpenclawBusinessWorkspace(runtime, "container-1", "Shop");

  assert.equal(agents, `${businessGuidance("Shop")}\n\n## What customers should know\n\nClosed on Fridays.\n`);
});

test("memory and bootstrap files in the business workspace are removed, and a failed removal is an error", async () => {
  const calls: string[][] = [];
  const ok = { execCommandBuffer: async (_id: string, cmd: string[]) => (calls.push(cmd), { exitCode: 0, stdout: Buffer.alloc(0), stderr: "" }) } as unknown as ContainerRuntime;
  await clearOpenclawBusinessMemory(ok, "container-1");
  assert.deepEqual(calls, [[
    "rm",
    "-rf",
    "/home/node/.openclaw/workspace-business/MEMORY.md",
    "/home/node/.openclaw/workspace-business/memory",
    "/home/node/.openclaw/workspace-business/BOOTSTRAP.md",
  ]]);

  const failing = { execCommandBuffer: async () => ({ exitCode: 1, stdout: Buffer.alloc(0), stderr: "" }) } as unknown as ContainerRuntime;
  await assert.rejects(clearOpenclawBusinessMemory(failing, "container-1"));
});

function entriesOf(archive: Buffer): Promise<{ name: string; uid?: number; mode?: number; body: string }[]> {
  const extract = tar.extract();
  const entries: { name: string; uid?: number; mode?: number; body: string }[] = [];
  return new Promise((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        entries.push({ name: header.name, uid: header.uid, mode: header.mode, body: Buffer.concat(chunks).toString("utf8") });
        next();
      });
      stream.on("error", reject);
    });
    extract.on("finish", () => resolve(entries));
    extract.on("error", reject);
    extract.end(archive);
  });
}

// Doctor migrates the stores and config; the WhatsApp plugin lives in every volume (with or without a
// WhatsApp channel) and only an explicit install moves it to the image's version. Both run offline and fail closed.
test("state preparation runs doctor, then the WhatsApp plugin install, on the bare volume", async () => {
  const runs: { name: string; cmd: string[]; volumes: string[] }[] = [];
  const runtime = {
    runOneOff: async (opts: { name: string; cmd: string[]; volumeMounts: { name: string }[] }) => {
      runs.push({ name: opts.name, cmd: opts.cmd, volumes: opts.volumeMounts.map((m) => m.name) });
      return { exitCode: 0, output: "" };
    },
  } as unknown as ContainerRuntime;

  await prepareOpenclawState(runtime, {
    image: "img",
    volumeName: "oc-1-state",
    containerName: "openclaw-1",
  });

  assert.deepEqual(runs, [
    { name: "openclaw-1-doctor", cmd: ["openclaw", "doctor", "--fix", "--non-interactive"], volumes: ["oc-1-state"] },
    {
      name: "openclaw-1-whatsapp-plugin",
      cmd: [
        "sh",
        "-c",
        "v=\"$(openclaw --version | awk '{ print $2 }')\" && [ -n \"$v\" ] && " +
          'openclaw plugins install "@openclaw/whatsapp@$v" --pin --accept-capabilities --force',
      ],
      volumes: ["oc-1-state"],
    },
    {
      name: "openclaw-1-own-plugins",
      cmd: [
        "sh",
        "-c",
        "set -e; ls /opt/agentforall/plugins/*.tgz >/dev/null; " +
          'for t in /opt/agentforall/plugins/*.tgz; do openclaw plugins install "npm-pack:$t" --force --accept-capabilities; done',
      ],
      volumes: ["oc-1-state"],
    },
  ]);
});

test("a failed doctor run stops the preparation with its output", async () => {
  const runtime = {
    runOneOff: async () => ({ exitCode: 1, output: "Legacy session store requires migration\n" }),
  } as unknown as ContainerRuntime;

  await assert.rejects(
    prepareOpenclawState(runtime, { image: "img", volumeName: "v", containerName: "c" }),
    /doctor exited 1: Legacy session store requires migration/,
  );
});
