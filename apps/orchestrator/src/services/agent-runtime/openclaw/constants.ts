import type { RuntimeUser } from "../../runtime-users.js";

export const OPENCLAW_INTERNAL_PORT = 18789;
export const OPENCLAW_HEALTH_PATH = "/healthz";
// /readyz is channel-aware in 2026.8 (503 while a channel is unlinked); startup is the gateway's own state.
export const OPENCLAW_STARTUP_PATH = "/startupz";
export const OPENCLAW_WHATSAPP_CHANNEL = "whatsapp";
export const OPENCLAW_STATE_ROOT = "/home/node/.openclaw";
export const OPENCLAW_STATE_PARENT = "/home/node";
export const OPENCLAW_CONFIG_PATH = `${OPENCLAW_STATE_ROOT}/openclaw.json`;
export const OPENCLAW_ENV_PATH = `${OPENCLAW_STATE_ROOT}/.env`;
export const OPENCLAW_CONFIG_APPLY_TIMEOUT_MS = 20_000;
export const OPENCLAW_WORKSPACE_PATH = `${OPENCLAW_STATE_ROOT}/workspace`;
export const OPENCLAW_WHATSAPP_SESSION_DIR = "whatsapp-session";
export const OPENCLAW_WHATSAPP_SESSION_PARENT = OPENCLAW_STATE_ROOT;
export const OPENCLAW_WHATSAPP_SESSION_PATH = `${OPENCLAW_WHATSAPP_SESSION_PARENT}/${OPENCLAW_WHATSAPP_SESSION_DIR}`;
export const OPENCLAW_BACKUP_TIMEOUT_MS = 15 * 60 * 1000;
export const OPENCLAW_MAX_BACKUP_BYTES = 512 * 1024 * 1024;
export const OPENCLAW_MAX_RESTORE_BYTES = 1024 * 1024 * 1024;
export const OPENCLAW_MAX_RESTORE_ENTRIES = 50_000;

export const OPENCLAW_USER: RuntimeUser = {
  uid: 1000,
  gid: 1000,
  uname: "node",
  gname: "node",
};
