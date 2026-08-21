export const PROVISIONING_STAGES = [
  "reserved",
  "container_created",
  "backup_restored",
  "started",
  "running",
] as const;
export type ProvisioningStage = (typeof PROVISIONING_STAGES)[number];

const STAGE_BY_EVENT: Record<string, ProvisioningStage> = {
  "provision.requested": "reserved",
  "provision.container_created": "container_created",
  "provision.backup_restored": "backup_restored",
  "provision.started": "started",
  "provision.running": "running",
};

export const PROVISIONING_EVENT_TYPES = Object.keys(STAGE_BY_EVENT);

export function provisioningStageOf(eventType: string): ProvisioningStage | null {
  return STAGE_BY_EVENT[eventType] ?? null;
}
