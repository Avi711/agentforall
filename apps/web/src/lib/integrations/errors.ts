import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";
import { INTEGRATION_MAX_ACCOUNTS_PER_APP } from "./schemas";

export type IntegrationErrorKind = "label_taken" | "limit_reached" | "invalid_label" | "unexpected";

// Routes pass the orchestrator's `{ code }` through as `error.details`; our own validation answers `invalid_body`.
export function integrationErrorKind(body: unknown): IntegrationErrorKind {
  const error = field(body, "error");
  if (field(error, "code") === "invalid_body") return "invalid_label";
  switch (field(field(error, "details"), "code")) {
    case "ACCOUNT_LABEL_TAKEN":
      return "label_taken";
    case "ACCOUNT_LIMIT_REACHED":
      return "limit_reached";
    case "VALIDATION_ERROR":
      return "invalid_label";
    default:
      return "unexpected";
  }
}

export function integrationErrorHe(kind: IntegrationErrorKind, appName: string): string {
  switch (kind) {
    case "label_taken":
      return `כבר יש חשבון ${appName} בשם הזה. בחרו שם אחר.`;
    case "limit_reached":
      return `אפשר לחבר עד ${INTEGRATION_MAX_ACCOUNTS_PER_APP} חשבונות ${appName}. נתקו אחד כדי להוסיף חדש.`;
    case "invalid_label":
      return "השם לא תקין. נסו שם קצר, בלי סימנים מיוחדים.";
    case "unexpected":
      return UNEXPECTED_ERROR_HE;
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}
