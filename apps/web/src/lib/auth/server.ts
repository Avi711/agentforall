import "server-only";
import { after } from "next/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "../db";
import { botService } from "../bots/service";
import { getBillingService } from "../billing";
import { captcha, haveIBeenPwned } from "better-auth/plugins";
import { deleteUserOptions } from "./delete-user";
import { getAuthService } from "./service";
import { emailPasswordOptions } from "./email-password";
import { USER_ADDITIONAL_FIELDS } from "./user-fields";
import { PASSWORD_COMPROMISED_HE } from "../messages.he";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const BASE_URL = requireEnv("BETTER_AUTH_URL");
requireEnv("RESEND_API_KEY");

// Cloudflare's always-pass test secrets start with 1x/2x/3x.
function turnstileSecret(): string {
  const secret = requireEnv("TURNSTILE_SECRET_KEY");
  // Previews share the production database, so they must not run on one either.
  if ((process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") && /^[123]x0{10}/.test(secret)) {
    throw new Error("TURNSTILE_SECRET_KEY is a Cloudflare test key");
  }
  return secret;
}

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

  ...emailPasswordOptions({
    deliver: (kind, email) => getAuthService().deliver(kind, email),
    background: (work) => after(work),
    claimAccount: (userId) => getAuthService().claimAccount(userId),
    noteVerificationSent: (userId) => getAuthService().noteVerificationSent(userId),
    appUrl: BASE_URL,
  }),

  rateLimit: {
    storage: "database",
    customRules: {
      "/delete-user": { window: 60, max: 5 },
      "/reset-password": { window: 60, max: 5 },
    },
  },

  // Better Auth attaches emails to its log lines (e.g. "User not found { email }"); keep only messages and errors.
  logger: {
    log: (level, message, ...args) => {
      // Database errors append the query parameters (emails among them), so only the part before them is kept.
      const errors = args
        .filter((arg): arg is Error => arg instanceof Error)
        .map((err) => `${err.name}: ${err.message.split("\nparams:")[0]}`);
      const line = message.startsWith("[better-auth]") ? message : `[better-auth] ${message}`;
      if (level === "error") console.error(line, ...errors);
      else if (level === "warn") console.warn(line, ...errors);
      else console.info(line);
    },
  },

  // Unlinkable Google sign-ins and bad links land on the login page, which explains them in Hebrew.
  onAPIError: {
    errorURL: "/login",
  },

  advanced: {
    ipAddress: {
      // Vercel overwrites it with the single client IP, so Better Auth's leftmost read is safe here (unlike raw XFF).
      ipAddressHeaders: ["x-vercel-forwarded-for"],
    },
    // Emails never delay the response, so a known and an unknown address answer equally fast.
    backgroundTasks: {
      handler: (promise) => after(promise),
    },
  },

  plugins: [
    captcha({
      provider: "cloudflare-turnstile",
      secretKey: turnstileSecret(),
      endpoints: ["/sign-up/email", "/sign-in/email", "/request-password-reset", "/send-verification-email"],
    }),
    haveIBeenPwned({ customPasswordCompromisedMessage: PASSWORD_COMPROMISED_HE }),
  ],

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
    additionalFields: USER_ADDITIONAL_FIELDS,
  },
});

export type Auth = typeof auth;
