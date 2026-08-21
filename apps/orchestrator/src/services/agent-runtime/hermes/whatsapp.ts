import type { ContainerRuntime } from "../../container-runtime.js";
import {
  HERMES_USER,
  HERMES_WHATSAPP_SESSION_DIR,
  HERMES_WHATSAPP_SESSION_PARENT,
} from "./constants.js";

const LOGOUT_TIMEOUT_MS = 20_000;

export function injectHermesWhatsappSession(
  runtime: ContainerRuntime,
  containerId: string,
  credsTar: Buffer,
): Promise<void> {
  return runtime.putArchiveUnderDir(
    containerId,
    HERMES_WHATSAPP_SESSION_PARENT,
    HERMES_WHATSAPP_SESSION_DIR,
    credsTar,
    HERMES_USER,
  );
}

export async function logoutHermesWhatsapp(
  runtime: ContainerRuntime,
  containerId: string,
): Promise<boolean> {
  const exitCode = await runtime.execCommand(
    containerId,
    ["sh", "-lc", `rm -rf ${HERMES_WHATSAPP_SESSION_PARENT}/${HERMES_WHATSAPP_SESSION_DIR}/*`],
    LOGOUT_TIMEOUT_MS,
  );
  return exitCode === 0;
}
