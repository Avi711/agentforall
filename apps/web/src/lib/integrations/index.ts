import "server-only";
import { readAppUrl } from "@/lib/billing/config";
import { getOrchestratorClient } from "@/lib/orchestrator/client";
import { IntegrationsService } from "./service";

let cached: IntegrationsService | null = null;

export function getIntegrationsService(): IntegrationsService {
  if (!cached) cached = new IntegrationsService(getOrchestratorClient(), readAppUrl(process.env));
  return cached;
}
