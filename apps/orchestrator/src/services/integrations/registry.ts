import type { AppConfig } from "../../config.js";
import { ComposioClient } from "./composio/client.js";
import { ComposioIntegrationProvider } from "./composio/adapter.js";
import { MockIntegrationProvider } from "./mock/adapter.js";
import type { IntegrationProvider } from "./provider.js";

type ProviderConfig = Pick<AppConfig, "integrationsProvider" | "composioApiKey" | "composioBaseUrl">;

// null = feature disabled; loadConfig already rejected inconsistent combinations.
export function createIntegrationProvider(
  config: ProviderConfig,
  fetchImpl: typeof fetch = fetch,
): IntegrationProvider | null {
  switch (config.integrationsProvider) {
    case undefined:
      return null;
    case "mock":
      return new MockIntegrationProvider();
    case "composio": {
      if (!config.composioApiKey) throw new Error("COMPOSIO_API_KEY is required");
      return new ComposioIntegrationProvider(
        new ComposioClient(config.composioBaseUrl, config.composioApiKey, fetchImpl),
      );
    }
  }
}
