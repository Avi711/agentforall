import type { VolumeMount } from "./container-runtime.js";

export const TENANT_CA_CONTAINER_PATH = "/etc/agent-forall/ca.crt";

interface CreateOptionsWithTrust {
  envVars: string[];
  volumeMounts?: VolumeMount[];
}

// Bots and sidecars reach the orchestrator over HTTPS signed by our internal CA; Node trusts it via this env.
export function withTenantCa<T extends CreateOptionsWithTrust>(options: T, hostCertPath: string | undefined): T {
  if (!hostCertPath) return options;
  return {
    ...options,
    envVars: [...options.envVars, `NODE_EXTRA_CA_CERTS=${TENANT_CA_CONTAINER_PATH}`],
    volumeMounts: [
      ...(options.volumeMounts ?? []),
      { name: hostCertPath, containerPath: TENANT_CA_CONTAINER_PATH, readOnly: true },
    ],
  };
}
