function readString(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value && value.length > 0) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is required`);
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export interface SidecarConfig {
  port: number;
  host: string;
  authToken: string;
  sessionDir: string;
  idleTimeoutMs: number;
  orchestrator: {
    baseUrl: string;
    serviceToken: string;
    instanceId: string;
  };
  phoneNumberHint: string | undefined;
  logLevel: string;
}

export function loadConfig(): SidecarConfig {
  return {
    port: readInt("PAIRING_PORT", 18790),
    host: readString("PAIRING_HOST", "0.0.0.0"),
    authToken: readString("PAIRING_AUTH_TOKEN"),
    sessionDir: readString("SESSION_DIR", "/data/session"),
    idleTimeoutMs: readInt("IDLE_TIMEOUT_MS", 10 * 60 * 1000),
    orchestrator: {
      baseUrl: readString("ORCHESTRATOR_BASE_URL"),
      serviceToken: readString("ORCHESTRATOR_SERVICE_TOKEN"),
      instanceId: readString("INSTANCE_ID"),
    },
    phoneNumberHint: process.env.PHONE_NUMBER_HINT || undefined,
    logLevel: readString("LOG_LEVEL", "info"),
  };
}
