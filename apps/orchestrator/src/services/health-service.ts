import type { ContainerRuntime } from "./container-runtime.js";
import type { HealthRepository } from "../storage/health-repository.js";

export type CheckResult = "ok" | "error";

export interface HealthReport {
  status: "healthy" | "unhealthy";
  checks: Record<string, CheckResult>;
  httpStatus: 200 | 503;
}

export class HealthService {
  constructor(
    private readonly healthRepo: HealthRepository,
    private readonly runtime: ContainerRuntime,
  ) {}

  async check(): Promise<HealthReport> {
    const checks: Record<string, CheckResult> = {
      database: await this.probe(() => this.healthRepo.ping()),
      docker: await this.probe(() => this.runtime.ping()),
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
