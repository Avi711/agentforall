import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { Resend } from "resend";
import { getDb } from "../db";
import { getOrchestratorClient } from "../orchestrator/client";

const RESEND_FROM = process.env.AUTH_EMAIL_FROM ?? "login@agentforall.co.il";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

async function sendMagicLinkEmail(email: string, url: string): Promise<void> {
  if (!resend) {
    // In dev without RESEND_API_KEY, log so developer can click it manually.
    console.log(`[auth] magic link for ${email}: ${url}`);
    return;
  }
  await resend.emails.send({
    from: RESEND_FROM,
    to: email,
    subject: "הכניסה ל-Agent For All",
    html: `
      <div dir="rtl" style="font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 1.6; color: #2a1810;">
        <p>שלום,</p>
        <p>לחצו על הקישור הבא כדי להיכנס לחשבון שלכם:</p>
        <p><a href="${url}" style="background: #c7542a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block;">כניסה ל-Agent For All</a></p>
        <p style="font-size: 14px; color: #6b5a52;">הקישור תקף לחמש דקות. אם לא ביקשתם להיכנס, אפשר להתעלם מהמייל.</p>
      </div>
    `,
  });
}

async function sendDeleteAccountEmail(email: string, url: string): Promise<void> {
  if (!resend) {
    console.log(`[auth] delete-account link for ${email}: ${url}`);
    return;
  }
  await resend.emails.send({
    from: RESEND_FROM,
    to: email,
    subject: "אישור מחיקת החשבון ב-Agent For All",
    html: `
      <div dir="rtl" style="font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 1.6; color: #2a1810;">
        <p>שלום,</p>
        <p>ביקשתם למחוק את חשבונכם ב-Agent For All. מחיקה זו תסיר את הסוכן, את חיבור ה-WhatsApp וכל הנתונים, ואינה הפיכה.</p>
        <p><a href="${url}" style="background: #b91c1c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block;">אישור מחיקת החשבון</a></p>
        <p style="font-size: 14px; color: #6b5a52;">אם לא ביקשתם זאת, אפשר להתעלם מהמייל. הקישור תקף לחמש דקות.</p>
      </div>
    `,
  });
}

const BASE_URL = requireEnv("BETTER_AUTH_URL");

export const auth = betterAuth({
  secret: requireEnv("BETTER_AUTH_SECRET"),
  baseURL: BASE_URL,
  // Lock redirects (post-OAuth, post-magiclink, callbackURL on signIn) to our
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
    // Wipe the user's bot containers + encrypted creds before cascading to
    // sessions/accounts/instances. The orchestrator DELETE atomically removes
    // the Docker container, its volume, and blanks `whatsapp_creds`, so no
    // secrets survive the delete. If any bot destroy throws, Better Auth
    // aborts the user deletion — safe by default.
    deleteUser: {
      enabled: true,
      sendDeleteAccountVerification: async ({ user, url }) => {
        await sendDeleteAccountEmail(user.email, url);
      },
      beforeDelete: async (user) => {
        const client = getOrchestratorClient();
        const bots = await client.listBots(user.id);
        for (const bot of bots) {
          if (bot.status === "destroyed") continue;
          await client.deleteBot(user.id, bot.id);
        }
      },
    },
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

  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail(email, url);
      },
    }),
  ],
});

export type Auth = typeof auth;
