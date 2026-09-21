import { MIN_PASSWORD_LENGTH } from "@/lib/auth/policy";

export const AUTH_INPUT =
  "w-full px-4 py-3 rounded-xl border border-sand bg-white text-espresso placeholder:text-sand focus:outline-none focus:border-terra focus:ring-2 focus:ring-terra-pale disabled:opacity-50";
export const AUTH_PRIMARY =
  "w-full px-5 py-3 rounded-xl bg-espresso text-cream font-medium hover:bg-espresso-light transition disabled:opacity-50";
export const AUTH_LINK = "text-terra-dark underline underline-offset-4 hover:text-terra";
export const NEW_PASSWORD_HINT = `לפחות ${MIN_PASSWORD_LENGTH} תווים. משפט קצר שקל לזכור עובד מצוין.`;
export const AUTH_SECONDARY =
  "px-5 py-3 rounded-xl border border-sand bg-white text-espresso font-medium hover:bg-cream-dark transition disabled:opacity-50";
