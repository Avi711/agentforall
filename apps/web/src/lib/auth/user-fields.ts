import type { BetterAuthOptions } from "better-auth";

type AdditionalFields = NonNullable<NonNullable<BetterAuthOptions["user"]>["additionalFields"]>;

export const USER_ADDITIONAL_FIELDS = {
  consentedWhatsappAt: {
    type: "date",
    required: false,
    input: false,
  },
  consentVersion: {
    type: "number",
    required: false,
    defaultValue: 0,
    input: false,
  },
  betaAccess: {
    type: "boolean",
    required: false,
    defaultValue: false,
    input: false,
  },
} as const satisfies AdditionalFields;
