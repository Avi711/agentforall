import { z } from "zod";

const hex256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, "must be 64 hex characters (256-bit key)");

const MIN_API_KEY_LENGTH = 32;

const apiKeysSchema = z.string().transform((val) => {
  const parsed: unknown = JSON.parse(val);
  const record = z.record(z.string().min(1)).parse(parsed);

  for (const key of Object.keys(record)) {
    if (key.length < MIN_API_KEY_LENGTH) {
      throw new Error(
        `API key must be at least ${MIN_API_KEY_LENGTH} characters`,
      );
    }
  }

  return record;
});

const booleanEnv = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

const AppConfigSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  nodeEnv: z.enum(["development", "production", "test"]).default("development"),
  trustProxy: booleanEnv.default("true"),

  databaseUrl: z.string().url(),
  encryptionKey: hex256,

  apiKeys: apiKeysSchema,
  serviceTokens: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return [] as string[];
      const parsed = val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const token of parsed) {
        if (token.length < MIN_API_KEY_LENGTH) {
          throw new Error(
            `service token must be at least ${MIN_API_KEY_LENGTH} characters`,
          );
        }
      }
      return parsed;
    }),

  openclawImage: z.string().default("ghcr.io/avi711/openclaw-browser:latest"),
  dockerHost: z.string().optional(),
  dockerPort: z.coerce.number().int().optional(),
  dockerSocketPath: z.string().optional(),
  dockerNetwork: z.string().default("tenant-net"),

  portRangeStart: z.coerce.number().int().min(1024).max(65535).default(19000),
  portRangeEnd: z.coerce.number().int().min(1024).max(65535).default(19999),

  healthPollIntervalMs: z.coerce.number().int().min(5000).default(15_000),
  healthDegradedThreshold: z.coerce.number().int().min(1).default(5),
  healthUnhealthyThreshold: z.coerce.number().int().min(2).default(10),
  // OpenClaw /healthz blocks during plugin installs + first-message processing;
  // 5s caused steady-state oscillation. 10s aligns with its internal grace.
  healthRequestTimeoutMs: z.coerce.number().int().min(1000).default(10_000),

  shutdownTimeoutMs: z.coerce.number().int().min(1000).default(10_000),

  reconcileOnStartup: booleanEnv.default("true"),
  reconcileIntervalMs: z.coerce.number().int().min(10_000).default(60_000),

  maxProvisionRetries: z.coerce.number().int().min(1).default(3),
  maxInstancesPerUser: z.coerce.number().int().min(1).default(1),

  rateLimitMax: z.coerce.number().int().min(1).default(100),
  rateLimitWindowMs: z.coerce.number().int().min(1000).default(60_000),

  pairingImage: z
    .string()
    .default("ghcr.io/agentforall/whatsapp-pairing:latest"),
  pairingPort: z.coerce.number().int().min(1).max(65535).default(18790),
  pairingIdleTimeoutMs: z.coerce
    .number()
    .int()
    .min(60_000)
    .default(10 * 60_000),
  pairingRequestTimeoutMs: z.coerce.number().int().min(1000).default(5_000),
  pairingStaleThresholdMs: z.coerce
    .number()
    .int()
    .min(60_000)
    .default(15 * 60_000),
  pairingLogLevel: z
    .enum(["trace", "debug", "info", "warn", "error"])
    .default("info"),
  orchestratorInternalUrl: z
    .string()
    .url()
    .default("http://orchestrator:3000"),

  // LLM defaults — applied when a create-bot request omits `provider`.
  // The web dashboard never sends provider, so all bots inherit these.
  defaultProviderName: z
    .enum(["anthropic", "openai", "openrouter", "gemini"])
    .default("anthropic"),
  defaultProviderApiKey: z.string().min(1).optional(),
  defaultProviderModel: z.string().min(1).default("claude-opus-4-7"),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export interface PairingConfig {
  image: string;
  port: number;
  idleTimeoutMs: number;
  requestTimeoutMs: number;
  staleThresholdMs: number;
  logLevel: string;
  orchestratorInternalUrl: string;
  /** Dev only: orchestrator runs on host and can't use Docker DNS, so sidecar publishes a 127.0.0.1 port. */
  publishSidecarPort: boolean;
}

export function extractPairingConfig(config: AppConfig): PairingConfig {
  return {
    image: config.pairingImage,
    port: config.pairingPort,
    idleTimeoutMs: config.pairingIdleTimeoutMs,
    requestTimeoutMs: config.pairingRequestTimeoutMs,
    staleThresholdMs: config.pairingStaleThresholdMs,
    logLevel: config.pairingLogLevel,
    orchestratorInternalUrl: config.orchestratorInternalUrl,
    publishSidecarPort: config.nodeEnv === "development",
  };
}

export function loadConfig(): AppConfig {
  const result = AppConfigSchema.safeParse({
    host: process.env.HOST,
    port: process.env.PORT,
    nodeEnv: process.env.NODE_ENV,
    trustProxy: process.env.TRUST_PROXY,
    databaseUrl: process.env.DATABASE_URL,
    encryptionKey: process.env.ENCRYPTION_KEY,
    apiKeys: process.env.API_KEYS,
    serviceTokens: process.env.SERVICE_TOKENS,
    openclawImage: process.env.OPENCLAW_IMAGE,
    dockerHost: process.env.DOCKER_HOST,
    dockerPort: process.env.DOCKER_PORT,
    dockerSocketPath: process.env.DOCKER_SOCKET_PATH,
    dockerNetwork: process.env.DOCKER_NETWORK,
    portRangeStart: process.env.PORT_RANGE_START,
    portRangeEnd: process.env.PORT_RANGE_END,
    healthPollIntervalMs: process.env.HEALTH_POLL_INTERVAL_MS,
    healthDegradedThreshold: process.env.HEALTH_DEGRADED_THRESHOLD,
    healthUnhealthyThreshold: process.env.HEALTH_UNHEALTHY_THRESHOLD,
    healthRequestTimeoutMs: process.env.HEALTH_REQUEST_TIMEOUT_MS,
    shutdownTimeoutMs: process.env.SHUTDOWN_TIMEOUT_MS,
    reconcileOnStartup: process.env.RECONCILE_ON_STARTUP,
    reconcileIntervalMs: process.env.RECONCILE_INTERVAL_MS,
    maxProvisionRetries: process.env.MAX_PROVISION_RETRIES,
    maxInstancesPerUser: process.env.MAX_INSTANCES_PER_USER,
    rateLimitMax: process.env.RATE_LIMIT_MAX,
    rateLimitWindowMs: process.env.RATE_LIMIT_WINDOW_MS,
    pairingImage: process.env.PAIRING_IMAGE,
    pairingPort: process.env.PAIRING_PORT,
    pairingIdleTimeoutMs: process.env.PAIRING_IDLE_TIMEOUT_MS,
    pairingRequestTimeoutMs: process.env.PAIRING_REQUEST_TIMEOUT_MS,
    pairingStaleThresholdMs: process.env.PAIRING_STALE_THRESHOLD_MS,
    pairingLogLevel: process.env.PAIRING_LOG_LEVEL,
    orchestratorInternalUrl: process.env.ORCHESTRATOR_INTERNAL_URL,
    defaultProviderName: process.env.DEFAULT_PROVIDER_NAME,
    defaultProviderApiKey: process.env.DEFAULT_PROVIDER_API_KEY,
    defaultProviderModel: process.env.DEFAULT_PROVIDER_MODEL,
  });

  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${formatted}`);
  }

  if (result.data.portRangeEnd <= result.data.portRangeStart) {
    throw new Error(
      `PORT_RANGE_END (${result.data.portRangeEnd}) must be greater than PORT_RANGE_START (${result.data.portRangeStart})`,
    );
  }

  return result.data;
}
