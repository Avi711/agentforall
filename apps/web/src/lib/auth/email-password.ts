import type { BetterAuthOptions } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import type { OutgoingEmail } from "../email/client";
import {
  existingAccountEmail,
  passwordChangedEmail,
  resetPasswordEmail,
  verifyEmail,
} from "../email/auth-templates";
import {
  EMAIL_VERIFICATION_TTL_HOURS,
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  RESET_PASSWORD_TTL_MINUTES,
  CONFIRM_INTENT_COOKIE,
  UNVERIFIED_SIGN_UP_MAX_AGE_DAYS,
} from "./policy";
import { USER_ADDITIONAL_FIELDS } from "./user-fields";

export type AuthEmailKind = "verify-email" | "reset-password" | "password-changed" | "existing-account";

export interface EmailPasswordDeps {
  deliver(kind: AuthEmailKind, email: OutgoingEmail): Promise<void>;
  // Keeps work alive past the response without the caller waiting on it.
  background(work: Promise<unknown>): void;
  // Marks the mailbox proven; a still-unverified account also drops the profile its signer-up typed.
  claimAccount(userId: string): Promise<void>;
  noteVerificationSent(userId: string): Promise<void>;
  appUrl: string;
}

const LAST_LINK_AGE_MS = (UNVERIFIED_SIGN_UP_MAX_AGE_DAYS * 24 - EMAIL_VERIFICATION_TTL_HOURS) * 60 * 60 * 1000;

export function normalizeName(name: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH);
}

type EmailPasswordOptions = Required<
  Pick<BetterAuthOptions, "emailAndPassword" | "emailVerification" | "databaseHooks" | "hooks">
>;

export function emailPasswordOptions(deps: EmailPasswordDeps): EmailPasswordOptions {
  const loginUrl = `${deps.appUrl}/login`;

  return {
    emailAndPassword: {
      enabled: true,
      // Also turns duplicate sign-ups into the same generic answer, so no one learns which emails exist.
      requireEmailVerification: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      resetPasswordTokenExpiresIn: RESET_PASSWORD_TTL_MINUTES * 60,
      revokeSessionsOnPasswordReset: true,
      // Same keys and values as a real new user, or the duplicate answer would give the account away.
      customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
        ...coreFields,
        name: normalizeName(coreFields.name),
        image: null,
        ...syntheticDefaults(),
        ...additionalFields,
        id,
      }),
      sendResetPassword: ({ user, url }) => deps.deliver("reset-password", resetPasswordEmail(user.email, url)),
      // The reset link proves the mailbox and replaces any password a squatter set before the owner arrived.
      onPasswordReset: async ({ user }) => {
        try {
          await deps.claimAccount(user.id);
        } catch (err) {
          console.error("[auth] claiming the account after reset failed", err instanceof Error ? err.message : err);
        }
        deps.background(deps.deliver("password-changed", passwordChangedEmail(user.email, loginUrl)));
      },
      onExistingUserSignUp: ({ user }) =>
        deps.deliver("existing-account", existingAccountEmail(user.email, loginUrl, user.emailVerified)),
    },
    emailVerification: {
      // Our confirm page signs in first to prove the password, which must not mail yet another link.
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
      expiresIn: EMAIL_VERIFICATION_TTL_HOURS * 3600,
      sendVerificationEmail: async ({ user, token, url }) => {
        // The purge removes it at the hard age cap; a link sent now would outlive the account and could confirm a later sign-up.
        if (Date.now() - user.createdAt.getTime() > LAST_LINK_AGE_MS) return;
        await deps.deliver("verify-email", verifyEmail(user.email, confirmPageUrl(deps.appUrl, token, url)));
        try {
          await deps.noteVerificationSent(user.id);
        } catch (err) {
          console.error("[auth] recording a verification send failed", err instanceof Error ? err.message : err);
        }
      },
    },
    databaseHooks: {
      user: {
        create: {
          // A password sign-up never brings a picture: an attacker-chosen URL would render on the owner's dashboard.
          before: async (user, ctx) => ({
            data: { ...user, name: normalizeName(user.name), image: ctx?.path === "/sign-up/email" ? null : user.image },
          }),
        },
      },
    },
    hooks: {
      // Verifying signs in, so any other way to reach it (a link, a redirect chain) is login CSRF.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/verify-email" || !ctx.request) return;
        if (!ctx.getCookie(CONFIRM_INTENT_COOKIE)) throw ctx.redirect("/login?error=VERIFY_FROM_OTHER_SITE");
        ctx.setCookie(CONFIRM_INTENT_COOKIE, "", { path: "/", maxAge: 0 });
      }),
    },
  };
}

function confirmPageUrl(appUrl: string, token: string, betterAuthUrl: string): string {
  const page = new URL("/verify-email", appUrl);
  page.searchParams.set("token", token);
  const callbackURL = new URL(betterAuthUrl).searchParams.get("callbackURL");
  if (callbackURL) page.searchParams.set("callbackURL", callbackURL);
  return page.toString();
}

function syntheticDefaults(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(USER_ADDITIONAL_FIELDS).map(([key, field]) => [key, "defaultValue" in field ? field.defaultValue : null]),
  );
}
