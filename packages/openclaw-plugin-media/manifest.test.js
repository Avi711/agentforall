import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PLUGIN_ID, PROVIDER_ID, createMediaUnderstandingProvider } from "./provider.js";

const manifest = JSON.parse(readFileSync(new URL("./openclaw.plugin.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Every id here is matched somewhere else — the manifest, the orchestrator's rendered config, the
// installed package — and a mismatch fails the way this plugin exists to prevent: silently.
test("the manifest declares exactly the provider the code registers", () => {
  assert.equal(manifest.id, PLUGIN_ID);
  assert.deepEqual(manifest.contracts.mediaUnderstandingProviders, [PROVIDER_ID]);
  assert.deepEqual(Object.keys(manifest.mediaUnderstandingProviderMetadata), [PROVIDER_ID]);
  assert.deepEqual(
    manifest.mediaUnderstandingProviderMetadata[PROVIDER_ID].capabilities,
    createMediaUnderstandingProvider().capabilities,
  );
});

test("the plugin loads on startup, since a provider registered later is never consulted", () => {
  assert.equal(manifest.activation.onStartup, true);
});

// OpenClaw resolves provider auth before it calls transcribeAudio and answers ProviderAuthError
// without this declaration — the plugin is then never reached at all. Built-in audio providers
// (deepgram, elevenlabs) declare theirs the same way.
test("the manifest declares where the provider's key comes from", () => {
  assert.deepEqual(manifest.setup.providers, [
    { id: PROVIDER_ID, envVars: ["AGENTFORALL_MEDIA_API_KEY"] },
  ]);
});

// A module missing from `files` is absent only inside the container, where nothing would catch it.
test("every module the plugin needs at runtime is published", () => {
  const shipped = readdirSync(fileURLToPath(new URL(".", import.meta.url))).filter(
    (name) => (name.endsWith(".js") && !name.endsWith(".test.js")) || name === "openclaw.plugin.json",
  );

  assert.ok(shipped.length >= 3, "expected the plugin's modules to be found");
  for (const file of shipped) {
    assert.ok(pkg.files.includes(file), `${file} is missing from package.json files`);
  }
});
