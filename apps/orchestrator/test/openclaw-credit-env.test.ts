import { test } from "node:test";
import assert from "node:assert/strict";
import { generateOpenclawFiles } from "../src/services/agent-runtime/openclaw/config.js";
import { configWith } from "./helpers/fixtures.js";

function dotEnvFor(provider: { name: "litellm" | "openai"; baseUrl?: string }): string {
  const config = configWith([{ type: "telegram", botToken: "t" }]);
  return generateOpenclawFiles(
    {
      ...config,
      provider: { ...config.provider, name: provider.name, apiKey: "sk-key", baseUrl: provider.baseUrl },
    },
    "token",
  ).dotEnv;
}

// The credit plugin reads its own variables on purpose: the model client's key name is derived
// from the provider id, so sharing it would break the plugin the day that id changes.
test("a litellm bot gets the credit plugin its own base url and key", () => {
  const dotEnv = dotEnvFor({ name: "litellm", baseUrl: "https://gateway.example/v1" });

  assert.match(dotEnv, /^AGENTFORALL_CREDIT_BASE_URL=https:\/\/gateway\.example\/v1$/m);
  assert.match(dotEnv, /^AGENTFORALL_CREDIT_API_KEY=sk-key$/m);
  // The model client keeps its own variable; the plugin must not have taken it over.
  assert.match(dotEnv, /^LITELLM_API_KEY=sk-key$/m);
});

// Without a budget gateway there is nothing to meter, and the plugin reads no key and fails open.
test("a bot on a direct provider gets no credit plugin variables", () => {
  const dotEnv = dotEnvFor({ name: "openai" });

  assert.doesNotMatch(dotEnv, /AGENTFORALL_CREDIT_/);
});
