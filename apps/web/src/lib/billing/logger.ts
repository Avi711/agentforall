export interface BillingLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export const consoleBillingLogger: BillingLogger = {
  info: (message, meta) => console.log(`[billing] ${message}`, meta ?? {}),
  warn: (message, meta) => console.warn(`[billing] ${message}`, meta ?? {}),
  error: (message, meta) => console.error(`[billing] ${message}`, meta ?? {}),
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
