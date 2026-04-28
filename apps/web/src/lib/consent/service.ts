import "server-only";
import { CURRENT_CONSENT_VERSION } from "../consent-version";
import { ConsentRepository } from "./repository";

export interface ConsentStatus {
  accepted: boolean;
  acceptedAt: Date | null;
  version: number;
  currentVersion: number;
  stale: boolean;
}

export class ConsentService {
  private readonly repo: ConsentRepository;

  constructor(repo?: ConsentRepository) {
    this.repo = repo ?? new ConsentRepository();
  }

  async getStatus(userId: string): Promise<ConsentStatus> {
    const row = await this.repo.findByUserId(userId);
    const accepted = Boolean(row?.consentedAt);
    const version = row?.consentVersion ?? 0;
    return {
      accepted,
      acceptedAt: row?.consentedAt ?? null,
      version,
      currentVersion: CURRENT_CONSENT_VERSION,
      stale: accepted && version < CURRENT_CONSENT_VERSION,
    };
  }

  async record(userId: string): Promise<void> {
    const ok = await this.repo.upsert(userId, CURRENT_CONSENT_VERSION);
    if (!ok) throw new Error(`consent recorded for missing user ${userId}`);
  }
}

const defaultService = new ConsentService();

export function getConsentStatus(userId: string): Promise<ConsentStatus> {
  return defaultService.getStatus(userId);
}

export function recordConsent(userId: string): Promise<void> {
  return defaultService.record(userId);
}
