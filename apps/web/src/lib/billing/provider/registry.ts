import { PAYMENT_PROVIDERS } from "@agent-forall/db";
import type { Env } from "../config";
import type { PaymentProviderName } from "../domain";
import { BillingUnavailableError } from "../errors";
import type { BillingLogger } from "../logger";
import { DisabledPaymentProvider } from "../providers/disabled";
import { MockPaymentProvider } from "../providers/mock/adapter";
import { readMockProviderConfig } from "../providers/mock/config";
import type { PaymentProvider, ProviderDeps } from "./types";

type ProviderFactory = (env: Env, deps: ProviderDeps) => PaymentProvider;

// Adding a provider = one adapter + one line here. Nothing else in the app changes.
const FACTORIES: Record<PaymentProviderName, ProviderFactory> = {
  mock: (env) => new MockPaymentProvider(readMockProviderConfig(env)),
};

export interface ProviderRegistry {
  // Receives new checkouts; older subscriptions keep using the provider that created them.
  active: PaymentProvider;
  // Only providers with live credentials are addressable, so a disabled one never answers a webhook.
  byName(name: string): PaymentProvider | null;
}

function isPaymentProviderName(value: string): value is PaymentProviderName {
  return (PAYMENT_PROVIDERS as readonly string[]).includes(value);
}

export function resolveActiveProviderName(env: Env): PaymentProviderName {
  const raw = env.PAYMENT_PROVIDER?.trim();
  if (!raw) throw new BillingUnavailableError("PAYMENT_PROVIDER is not set");
  if (!isPaymentProviderName(raw)) throw new BillingUnavailableError(`unknown PAYMENT_PROVIDER "${raw}"`);
  return raw;
}

export function createProviderRegistry(env: Env, deps: ProviderDeps, log: BillingLogger): ProviderRegistry {
  let activeName: PaymentProviderName;
  try {
    activeName = resolveActiveProviderName(env);
  } catch (err) {
    if (!(err instanceof BillingUnavailableError)) throw err;
    log.warn("billing disabled", { reason: err.reason });
    return { active: new DisabledPaymentProvider(PAYMENT_PROVIDERS[0], err.reason), byName: () => null };
  }

  const providers = new Map<PaymentProviderName, PaymentProvider>();
  for (const name of PAYMENT_PROVIDERS) {
    try {
      providers.set(name, FACTORIES[name](env, deps));
    } catch (err) {
      if (!(err instanceof BillingUnavailableError)) throw err;
      if (name !== activeName) continue;
      log.error("active provider disabled", { provider: name, reason: err.reason });
      providers.set(name, new DisabledPaymentProvider(name, err.reason));
    }
  }

  const active = providers.get(activeName);
  if (!active) throw new Error(`provider ${activeName} missing from registry`);
  return {
    active,
    byName: (name) => {
      const provider = isPaymentProviderName(name) ? providers.get(name) : undefined;
      return provider?.available ? provider : null;
    },
  };
}
