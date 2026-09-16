import type { HealthRepository } from "../storage/health-repository.js";

export type CheckResult = "ok" | "error";

export interface HealthReport {
  status: "healthy" | "unhealthy";
  checks: Record<string, CheckResult>;
  httpStatus: 200 | 503;
}

// Process + database only: a host whose Docker is down is that host's problem, reported per host, not an outage of the API.
export class HealthService {
  constructor(private readonly healthRepo: HealthRepository) {}

  async check(): Promise<HealthReport> {
    const checks: Record<string, CheckResult> = {
      database: await this.probe(() => this.healthRepo.ping()),
    };
    const allOk = Object.values(checks).every((v) => v === "ok");
    return {
      status: allOk ? "healthy" : "unhealthy",
      checks,
      httpStatus: allOk ? 200 : 503,
    };
  }

  // Sentinel pattern: a probe failure must surface as "error", not propagate.
  private async probe(fn: () => Promise<unknown>): Promise<CheckResult> {
    try {
      await fn();
      return "ok";
    } catch {
      return "error";
    }
  }
}
