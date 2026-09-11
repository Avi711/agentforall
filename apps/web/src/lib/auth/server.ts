import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "../db";
import { botService } from "../bots/service";
import { getBillingService } from "../billing";
import { deleteUserOptions } from "./delete-user";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const BASE_URL = requireEnv("BETTER_AUTH_URL");

export const auth = betterAuth({
  secret: requireEnv("BETTER_AUTH_SECRET"),
  baseURL: BASE_URL,
  // Lock redirects (post-OAuth, callbackURL on signIn) to our
  // own origin. Without this Better Auth falls back to permissive defaults.
  trustedOrigins: [BASE_URL],

  database: drizzleAdapter(getDb(), {
    provider: "pg",
    usePlural: false,
  }),

  emailAndPassword: {
    enabled: false,
  },

  socialProviders: {
    google: {
      clientId: requireEnv("GOOGLE_CLIENT_ID"),
      clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    },
  },

  user: {
    deleteUser: deleteUserOptions({
      cancelBilling: (userId) => getBillingService().cancelForAccountDeletion(userId),
      deleteBots: (userId) => botService.deleteAllForUser(userId),
    }),
    additionalFields: {
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
    },
  },
});

export type Auth = typeof auth;
