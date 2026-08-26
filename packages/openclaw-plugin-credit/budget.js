// Pure budget logic, kept apart from the plugin entry so it can be tested without OpenClaw.

// Null means "could not tell", which lets the turn run: a LiteLLM blip must never mute a bot.
export function parseBudget(info, warn) {
  // A 200 that is not the key/info shape (a proxy error page, an envelope change) must not pass
  // as an uncapped key in silence.
  if (info === null || typeof info !== "object" || Array.isArray(info)) {
    warn("malformed", "key/info had no info object");
    return null;
  }
  // LiteLLM leaves max_budget null on an uncapped key, and Number(null) is 0 — which would read
  // as a spent budget — so nullish is settled before any coercion. Zero is a real ceiling.
  if (info.max_budget === null || info.max_budget === undefined) return null;
  const maxBudget = Number(info.max_budget);
  if (!Number.isFinite(maxBudget)) {
    warn("malformed", `key/info reported an unusable max_budget: ${String(info.max_budget)}`);
    return null;
  }
  if (info.spend === null || info.spend === undefined) {
    warn("malformed", "key/info reported no spend");
    return null;
  }
  const spend = Number(info.spend);
  if (!Number.isFinite(spend)) {
    warn("malformed", `key/info reported an unusable spend: ${String(info.spend)}`);
    return null;
  }
  return { spend, maxBudget };
}

// Same boundary LiteLLM enforces, so the plugin never claims a turn the model would have served.
export function isOverBudget(budget) {
  return budget.spend >= budget.maxBudget;
}

export function normalizeBaseUrl(raw) {
  if (!raw) return null;
  return raw.replace(/\/+$/, "").replace(/\/v1$/, "");
}
