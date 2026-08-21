import { z } from "zod";
import {
  AGENT_RUNTIME_KINDS,
  LLM_PROVIDERS,
  MODEL_INPUT_CAPABILITIES,
  PROVIDER_MEDIA_CAPABILITIES,
  USER_ID_PATTERN,
} from "./domain/types.js";

const hex256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, "must be 64 hex characters (256-bit key)");

const MIN_API_KEY_LENGTH = 32;

const apiKeysSchema = z.string().transform((val) => {
  const parsed: unknown = JSON.parse(val);
  const record = z
    .record(z.string().regex(USER_ID_PATTERN, "invalid user ID format"))
    .parse(parsed);

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

const emptyToUndefined = (value: unknown): unknown =>
  value === "" ? undefined : value;

const providerIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i, "invalid provider id");

function commaList<const T extends readonly string[]>(allowed: T) {
  const allowedValues = new Set<string>(allowed);
  return z
    .string()
    .optional()
    .transform((val): T[number][] | undefined => {
      if (!val) return undefined;
      const parsed = val
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      for (const entry of parsed) {
        if (!allowedValues.has(entry)) {
          throw new Error(`unsupported value '${entry}'`);
        }
      }
      return parsed as T[number][];
    });
}

const AppConfigSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  nodeEnv: z.enum(["development", "production", "test"]).default("development"),
  trustProxy: booleanEnv.default("true"),

  databaseUrl: z.string().url(),
  encryptionKey: hex256,

  // Identifies this orchestrator process when several share a database
  // (multi-host prod, blue/green, or local dev pointed at a shared DB).
  // Reconciler + health monitor only operate on rows stamped with this id.
  orchestratorHostId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "must be lowercase alphanumeric + dashes"),

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

  agentRuntimeKind: z.enum(AGENT_RUNTIME_KINDS).default("openclaw"),
  agentRuntimeImage: z.string().default("ghcr.io/avi711/openclaw-browser:latest"),
  hermesRuntimeImage: z
    .string()
    .default(
      "nousresearch/hermes-agent@sha256:b6e41c155d6bfce5ad83c5d0fec670086db8a43250e4511c9474134be5482d33",
    ),
  pullImagesOnStartup: booleanEnv.default("true"),
  dockerHost: z.string().optional(),
  dockerPort: z.coerce.number().int().optional(),
  dockerSocketPath: z.string().optional(),
  dockerNetwork: z.string().default("tenant-net"),

  portRangeStart: z.coerce.number().int().min(1024).max(65535).default(19000),
  portRangeEnd: z.coerce.number().int().min(1024).max(65535).default(19999),

  healthPollIntervalMs: z.coerce.number().int().min(5000).default(15_000),
  healthDegradedThreshold: z.coerce.number().int().min(1).default(5),
  healthUnhealthyThreshold: z.coerce.number().int().min(2).default(10),
  // Runtime health can block during plugin installs and first-message processing.
  healthRequestTimeoutMs: z.coerce.number().int().min(1000).default(10_000),
  healthMaxConcurrentChecks: z.coerce.number().int().min(1).default(10),

  shutdownTimeoutMs: z.coerce.number().int().min(1000).default(10_000),

  reconcileOnStartup: booleanEnv.default("true"),
  reconcileIntervalMs: z.coerce.number().int().min(10_000).default(60_000),
  runMigrationsOnStartup: booleanEnv.default("false"),

  maxProvisionRetries: z.coerce.number().int().min(1).default(3),
  maxInstancesPerUser: z.coerce.number().int().min(1).default(1),

  backupImportBucket: z.string().min(3).optional(),
  backupImportUploadOrigin: z.string().url().default("https://agentforall.co.il"),
  backupImportTtlSeconds: z.coerce.number().int().min(300).default(60 * 60),

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
  defaultProviderName: z.enum(LLM_PROVIDERS).default("anthropic"),
  defaultProviderId: z.preprocess(emptyToUndefined, providerIdSchema.optional()),
  defaultProviderApiKey: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
  defaultProviderModel: z.string().min(1).default("claude-opus-4-7"),
  defaultProviderBaseUrl: z.preprocess(
    emptyToUndefined,
    z.string().url().optional(),
  ),
  defaultProviderInput: commaList(MODEL_INPUT_CAPABILITIES),
  defaultProviderMedia: commaList(PROVIDER_MEDIA_CAPABILITIES),
  telegramManagerBotToken: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),

  litellmMasterKey: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
  litellmDefaultBudgetCents: z.coerce
    .number()
    .int()
    .min(1)
    .default(5000),
  litellmDefaultBudgetDuration: z.string().min(1).default("30d"),
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
    orchestratorHostId: process.env.ORCHESTRATOR_HOST_ID,
    apiKeys: process.env.API_KEYS,
    serviceTokens: process.env.SERVICE_TOKENS,
    agentRuntimeKind: process.env.AGENT_RUNTIME_KIND,
    agentRuntimeImage: process.env.AGENT_RUNTIME_IMAGE,
    hermesRuntimeImage: process.env.HERMES_RUNTIME_IMAGE,
    pullImagesOnStartup: process.env.PULL_IMAGES_ON_STARTUP,
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
    healthMaxConcurrentChecks: process.env.HEALTH_MAX_CONCURRENT_CHECKS,
    shutdownTimeoutMs: process.env.SHUTDOWN_TIMEOUT_MS,
    reconcileOnStartup: process.env.RECONCILE_ON_STARTUP,
    reconcileIntervalMs: process.env.RECONCILE_INTERVAL_MS,
    runMigrationsOnStartup: process.env.RUN_MIGRATIONS_ON_STARTUP,
    maxProvisionRetries: process.env.MAX_PROVISION_RETRIES,
    maxInstancesPerUser: process.env.MAX_INSTANCES_PER_USER,
    backupImportBucket: process.env.BACKUP_IMPORT_BUCKET,
    backupImportUploadOrigin: process.env.BACKUP_IMPORT_UPLOAD_ORIGIN,
    backupImportTtlSeconds: process.env.BACKUP_IMPORT_TTL_SECONDS,
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
    defaultProviderId: process.env.DEFAULT_PROVIDER_ID,
    defaultProviderApiKey: process.env.DEFAULT_PROVIDER_API_KEY,
    defaultProviderModel: process.env.DEFAULT_PROVIDER_MODEL,
    defaultProviderBaseUrl: process.env.DEFAULT_PROVIDER_BASE_URL,
    defaultProviderInput: process.env.DEFAULT_PROVIDER_INPUT,
    defaultProviderMedia: process.env.DEFAULT_PROVIDER_MEDIA,
    telegramManagerBotToken: process.env.TELEGRAM_MANAGER_BOT_TOKEN,
    litellmMasterKey: process.env.LITELLM_MASTER_KEY,
    litellmDefaultBudgetCents: process.env.LITELLM_DEFAULT_BUDGET_CENTS,
    litellmDefaultBudgetDuration: process.env.LITELLM_DEFAULT_BUDGET_DURATION,
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
