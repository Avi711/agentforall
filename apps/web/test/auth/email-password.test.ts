import { test } from "node:test";
import assert from "node:assert/strict";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { APIError } from "better-auth/api";
import { emailPasswordOptions, type AuthEmailKind } from "../../src/lib/auth/email-password";
import { USER_ADDITIONAL_FIELDS } from "../../src/lib/auth/user-fields";
import type { OutgoingEmail } from "../../src/lib/email/client";
import { CONFIRM_INTENT_COOKIE } from "../../src/lib/auth/policy";

type Row = Record<string, unknown>;

const EMAIL = "owner@example.com";
const PASSWORD = "correct horse battery";
const APP = "http://localhost:3000";

function setup(overrides: { claimAccount?: (userId: string) => Promise<void> } = {}) {
  const db: Record<string, Row[]> = { user: [], session: [], account: [], verification: [] };
  const sent: Array<{ kind: AuthEmailKind; email: OutgoingEmail }> = [];
  const touched: string[] = [];
  const backgroundWork: Array<Promise<unknown>> = [];
  const auth = betterAuth({
    secret: "test-secret-with-enough-entropy-000000",
    baseURL: APP,
    database: memoryAdapter(db),
    user: { additionalFields: USER_ADDITIONAL_FIELDS },
    ...emailPasswordOptions({
      deliver: async (kind, email) => {
        sent.push({ kind, email });
      },
      background: (work) => {
        backgroundWork.push(work);
      },
      claimAccount:
        overrides.claimAccount ??
        (async (userId) => {
          for (const user of db.user) if (user.id === userId) user.emailVerified = true;
        }),
      noteVerificationSent: async (userId) => {
        touched.push(userId);
      },
      appUrl: APP,
    }),
  });

  function link(kind: AuthEmailKind): URL {
    const mail = sent.findLast((m) => m.kind === kind);
    assert.ok(mail, `no ${kind} email sent`);
    const url = /https?:\/\/\S+/.exec(mail.email.text)?.[0];
    assert.ok(url);
    return new URL(url);
  }

  function resetToken(): string {
    return link("reset-password").pathname.split("/").pop() ?? "";
  }

  function signInSession(userId: string) {
    db.session.push({ id: `s-${db.session.length}`, userId, token: `t-${db.session.length}`, expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), updatedAt: new Date() });
  }

  const settle = () => Promise.all(backgroundWork.splice(0));

  return { auth, db, sent, touched, link, resetToken, signInSession, settle };
}

function rejectsWith(code: string) {
  return (err: unknown) => {
    assert.ok(err instanceof APIError);
    assert.equal(err.body?.code, code);
    return true;
  };
}

test("sign-up sends a confirmation email and opens no session until it is confirmed", async () => {
  const { auth, db, sent, touched } = setup();

  const result = await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Dana" } });

  assert.equal(result.token, null);
  assert.equal(db.session.length, 0);
  assert.deepEqual(sent.map((m) => m.kind), ["verify-email"]);
  assert.equal(sent[0]?.email.to, EMAIL);
  assert.match(sent[0]?.email.html ?? "", /dir="rtl"/);
  assert.deepEqual(touched, [db.user[0]?.id]);
});

test("the confirmation email links to our click-to-confirm page, never straight to the API", async () => {
  const { auth, link } = setup();
  await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Dana", callbackURL: "/login?redirect=%2Fapp" } });

  const url = link("verify-email");

  assert.equal(url.origin + url.pathname, `${APP}/verify-email`);
  assert.ok(url.searchParams.get("token"));
  assert.equal(url.searchParams.get("callbackURL"), "/login?redirect=%2Fapp");
});

test("the confirmation email never carries the name the signer-up typed", async () => {
  const { auth, sent } = setup();

  await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Visit evil.example now" } });

  assert.doesNotMatch(sent[0]?.email.html ?? "", /evil\.example/);
});

test("a duplicate sign-up answers with exactly the keys of a new one, and mails the owner instead", async () => {
  const { auth, db, sent } = setup();
  const fresh = await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Dana" } });

  const duplicate = await auth.api.signUpEmail({ body: { email: EMAIL, password: "another long password", name: "Eve" } });

  assert.deepEqual(Object.keys(duplicate.user).sort(), Object.keys(fresh.user).sort());
  assert.ok("consentedWhatsappAt" in duplicate.user);
  assert.equal(duplicate.token, null);
  assert.equal(db.user.length, 1);
  assert.deepEqual(sent.map((m) => m.kind), ["verify-email", "existing-account"]);
});

test("a duplicate sign-up echoes the name exactly as a new one would, even when padded and overlong", async () => {
  const name = `  ${"x".repeat(300)}  `;
  const first = setup();
  const fresh = await first.auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name } });
  const second = setup();
  await second.auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Dana" } });

  const duplicate = await second.auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name } });

  assert.equal(duplicate.user.name, fresh.user.name);
  assert.equal(duplicate.user.emailVerified, fresh.user.emailVerified);
  assert.equal(duplicate.user.image ?? null, fresh.user.image ?? null);
});

test("an unconfirmed account cannot sign in, and the attempt mails nothing new", async () => {
  const { auth, sent } = setup();
  await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Dana" } });

  await assert.rejects(auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD } }), rejectsWith("EMAIL_NOT_VERIFIED"));

  assert.deepEqual(sent.map((m) => m.kind), ["verify-email"]);
});

test("a password sign-up never keeps a picture URL", async () => {
  const { auth, db } = setup();

  await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Dana", image: "https://evil.example/pixel.png" } });

  assert.equal(db.user[0]?.image ?? null, null);
});

test("the confirm endpoint refuses any request our confirm page did not start, even a same-origin redirect chain", async () => {
  const { auth, db, link } = setup();
  await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Dana" } });
  const token = link("verify-email").searchParams.get("token") ?? "";

  const res = await auth.handler(
    new Request(`${APP}/api/auth/verify-email?token=${token}&callbackURL=/app`, { headers: { "sec-fetch-site": "same-origin" } }),
  );

  assert.equal(res.status, 302);
  assert.match(res.headers.get("location") ?? "", /error=VERIFY_FROM_OTHER_SITE/);
  assert.equal(db.user[0]?.emailVerified, false);
  assert.equal(db.session.length, 0);
});

test("the confirm endpoint accepts our own page's form", async () => {
  const { auth, db, link } = setup();
  await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Dana" } });
  const token = link("verify-email").searchParams.get("token") ?? "";

  const res = await auth.handler(
    new Request(`${APP}/api/auth/verify-email?token=${token}&callbackURL=/app`, { headers: { cookie: `${CONFIRM_INTENT_COOKIE}=1` } }),
  );

  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/app");
  assert.equal(db.user[0]?.emailVerified, true);
  assert.equal(db.session.length, 1);
});

test("an unconfirmed account with the wrong password answers like any wrong password, so confirming needs the real one", async () => {
  const { auth } = setup();
  await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Dana" } });

  await assert.rejects(auth.api.signInEmail({ body: { email: EMAIL, password: "a squatter's guess" } }), rejectsWith("INVALID_EMAIL_OR_PASSWORD"));
});

test("signing up again on a pending sign-up mails the pending-account variant, not a sign-in-with-Google hint", async () => {
  const { auth, sent } = setup();
  await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Dana" } });

  await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Dana" } });

  const mail = sent.find((m) => m.kind === "existing-account");
  assert.match(mail?.email.text ?? "", /עוד לא אושרה/);
});

test("no confirmation link is sent once a pending sign-up nears the purge's hard age cap", async () => {
  const { auth, db, sent } = setup();
  await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Dana" } });
  for (const user of db.user) user.createdAt = new Date(Date.now() - 6.5 * 24 * 60 * 60 * 1000);

  await auth.api.sendVerificationEmail({ body: { email: EMAIL } });

  assert.deepEqual(sent.map((m) => m.kind), ["verify-email"]);
});

test("a wrong password and an unknown email get the same error", async () => {
  const { auth } = setup();
  await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Dana" } });

  await assert.rejects(auth.api.signInEmail({ body: { email: EMAIL, password: "wrong password here" } }), rejectsWith("INVALID_EMAIL_OR_PASSWORD"));
  await assert.rejects(auth.api.signInEmail({ body: { email: "nobody@example.com", password: PASSWORD } }), rejectsWith("INVALID_EMAIL_OR_PASSWORD"));
});

test("passwords under 12 characters are refused", async () => {
  const { auth, db } = setup();

  await assert.rejects(auth.api.signUpEmail({ body: { email: EMAIL, password: "short-pass1", name: "Dana" } }), rejectsWith("PASSWORD_TOO_SHORT"));
  assert.equal(db.user.length, 0);
});

test("an overlong name is cut to 40 characters", async () => {
  const { auth, db } = setup();

  await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: `  ${"א".repeat(300)}` } });

  assert.equal(String(db.user[0]?.name).length, 40);
});

test("confirming the email verifies it and signs the user in", async () => {
  const { auth, db, link } = setup();
  await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Dana" } });

  await auth.api.verifyEmail({ query: { token: link("verify-email").searchParams.get("token") ?? "" } });

  assert.equal(db.user[0]?.emailVerified, true);
  assert.equal(db.session.length, 1);
  const signedIn = await auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD } });
  assert.ok(signedIn.token);
});

test("a reset request for an unknown email answers the same and sends nothing", async () => {
  const { auth, sent } = setup();

  const result = await auth.api.requestPasswordReset({ body: { email: "nobody@example.com", redirectTo: "/reset-password" } });

  assert.equal(result.status, true);
  assert.deepEqual(sent, []);
});

test("a password reset verifies the email, replaces the password, signs out everywhere and notifies", async () => {
  const { auth, db, sent, resetToken, signInSession, settle } = setup();
  await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Dana" } });
  signInSession(String(db.user[0]?.id));

  await auth.api.requestPasswordReset({ body: { email: EMAIL, redirectTo: "/reset-password" } });
  await auth.api.resetPassword({ body: { newPassword: "a brand new passphrase", token: resetToken() } });
  await settle();

  assert.equal(db.user[0]?.emailVerified, true);
  assert.equal(db.session.length, 0);
  assert.equal(sent.at(-1)?.kind, "password-changed");
  await assert.rejects(auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD } }), rejectsWith("INVALID_EMAIL_OR_PASSWORD"));
  const signedIn = await auth.api.signInEmail({ body: { email: EMAIL, password: "a brand new passphrase" } });
  assert.ok(signedIn.token);
});

test("a reset still signs out every session when claiming the account fails", async () => {
  const { auth, db, resetToken, signInSession } = setup({
    claimAccount: async () => {
      throw new Error("database unavailable");
    },
  });
  await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Dana" } });
  signInSession(String(db.user[0]?.id));

  await auth.api.requestPasswordReset({ body: { email: EMAIL, redirectTo: "/reset-password" } });
  await auth.api.resetPassword({ body: { newPassword: "a brand new passphrase", token: resetToken() } });

  assert.equal(db.session.length, 0);
});

test("a Google-only user can add a password through reset, which proves the mailbox", async () => {
  const { auth, db, resetToken } = setup();
  const now = new Date();
  db.user.push({ id: "g1", email: EMAIL, name: "Dana", emailVerified: true, image: null, createdAt: now, updatedAt: now, consentVersion: 0, betaAccess: false });
  db.account.push({ id: "a1", userId: "g1", providerId: "google", accountId: "google-sub", createdAt: now, updatedAt: now });

  await auth.api.requestPasswordReset({ body: { email: EMAIL, redirectTo: "/reset-password" } });
  await auth.api.resetPassword({ body: { newPassword: "a brand new passphrase", token: resetToken() } });

  assert.deepEqual(db.account.map((a) => a.providerId).sort(), ["credential", "google"]);
  const signedIn = await auth.api.signInEmail({ body: { email: EMAIL, password: "a brand new passphrase" } });
  assert.ok(signedIn.token);
});
