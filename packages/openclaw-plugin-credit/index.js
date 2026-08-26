import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { isOverBudget, normalizeBaseUrl, parseBudget } from "./budget.js";

const KEY_INFO_TIMEOUT_MS = 2500;
const VERDICT_TTL_MS = 15_000;
const WARN_INTERVAL_MS = 10 * 60_000;
const DEFAULT_TOPUP_URL = "https://agentforall.co.il/app";

export default definePluginEntry({
  id: "agentforall-credit",
  name: "Agent For All credit",
  register(api) {
    const readBudget = createBudgetReader(api?.logger);
    api.on("before_agent_reply", async (_event, ctx) => {
      const budget = await readBudget();
      if (budget === null || !isOverBudget(budget)) return undefined;
      // A heartbeat has nobody waiting on it, so it is stopped without a notice.
      if (ctx?.trigger !== "user") return { handled: true };
      return { handled: true, reply: { text: outOfCreditText() } };
    });
  },
});

function createBudgetReader(logger) {
  const warn = createThrottledWarn(logger);
  let cached = null;

  // Null means "could not tell", which lets the turn run: a LiteLLM blip must never mute a bot.
  return async function readBudget() {
    if (cached && cached.expiresAt > Date.now()) return cached.budget;
    const budget = await fetchBudget(warn);
    cached = { budget, expiresAt: Date.now() + VERDICT_TTL_MS };
    return budget;
  };
}

async function fetchBudget(warn) {
  const baseUrl = normalizeBaseUrl(process.env.AGENTFORALL_CREDIT_BASE_URL);
  const apiKey = process.env.AGENTFORALL_CREDIT_API_KEY;
  if (!baseUrl || !apiKey) {
    warn("unconfigured", "AGENTFORALL_CREDIT_BASE_URL or AGENTFORALL_CREDIT_API_KEY is missing");
    return null;
  }

  let res;
  try {
    res = await fetch(`${baseUrl}/key/info`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(KEY_INFO_TIMEOUT_MS),
    });
  } catch (err) {
    warn("unreachable", `key/info request failed: ${errorText(err)}`);
    return null;
  }
  if (!res.ok) {
    warn("http", `key/info returned ${res.status}`);
    return null;
  }

  let info;
  try {
    info = (await res.json())?.info;
  } catch (err) {
    warn("malformed", `key/info body was not json: ${errorText(err)}`);
    return null;
  }
  return parseBudget(info, warn);
}

// The gate fails open by design, so a silent failure looks exactly like a funded key. Say so.
function createThrottledWarn(logger) {
  const lastWarnedAt = new Map();
  return (reason, message) => {
    const now = Date.now();
    if (now - (lastWarnedAt.get(reason) ?? -Infinity) < WARN_INTERVAL_MS) return;
    lastWarnedAt.set(reason, now);
    const line = `[agentforall-credit] budget check skipped (${reason}): ${message}`;
    if (typeof logger?.warn === "function") logger.warn(line);
    else console.warn(line);
  };
}

function errorText(err) {
  return err instanceof Error ? err.message : String(err);
}

function outOfCreditText() {
  const url = process.env.AGENTFORALL_CREDIT_TOPUP_URL || DEFAULT_TOPUP_URL;
  return [
    "נגמרה המכסה שלך לחודש הזה, אז אני לא יכול לענות כרגע.",
    "",
    `אפשר להוסיף מכסה או לשדרג כאן: ${url}`,
    "",
    "ברגע שתוסיפו, אני חוזר לעבוד מיד.",
  ].join("\n");
}
