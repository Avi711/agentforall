import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const API_ROOT = path.join(process.cwd(), "src/app/api");

async function routeFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return routeFiles(full);
      return e.name === "route.ts" ? [full] : [];
    }),
  );
  return found.flat();
}

// The consent text is entirely about WhatsApp banning numbers that run bots. Gating any other
// channel on it blocks a user who never chose WhatsApp — Telegram shipped that way once.
test("only WhatsApp pairing routes are gated on the WhatsApp consent", async () => {
  const files = await routeFiles(API_ROOT);
  const gated: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (source.includes("requireWhatsappConsent: true")) {
      gated.push(path.relative(API_ROOT, file).split(path.sep).join("/"));
    }
  }

  assert.deepEqual(gated.sort(), [
    "bot/[id]/pair/code/route.ts",
    "bot/[id]/pair/qr/route.ts",
    "bot/[id]/pair/route.ts",
  ]);
});
