import type { RuntimeUser } from "../../runtime-users.js";

export const HERMES_INTERNAL_PORT = 8642;
export const HERMES_HEALTH_PATH = "/health";
export const HERMES_STATE_ROOT = "/opt/data";
export const HERMES_STATE_PARENT = "/opt";
export const HERMES_STATE_DIR = "data";
export const HERMES_CONFIG_PATH = `${HERMES_STATE_ROOT}/config.yaml`;
export const HERMES_WORKSPACE_PATH = `${HERMES_STATE_ROOT}/workspace`;
export const HERMES_WHATSAPP_SESSION_DIR = "session";
export const HERMES_WHATSAPP_SESSION_PARENT = `${HERMES_STATE_ROOT}/platforms/whatsapp`;
export const HERMES_BACKUP_TIMEOUT_MS = 15 * 60 * 1000;
export const HERMES_MAX_BACKUP_BYTES = 512 * 1024 * 1024;
export const HERMES_MAX_RESTORE_BYTES = 1024 * 1024 * 1024;
export const HERMES_MAX_RESTORE_ENTRIES = 50_000;

export const HERMES_USER: RuntimeUser = {
  uid: 10000,
  gid: 10000,
  uname: "hermes",
  gname: "hermes",
};
