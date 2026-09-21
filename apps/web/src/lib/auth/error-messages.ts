import { MIN_PASSWORD_LENGTH } from "./policy";
import { PASSWORD_COMPROMISED_HE, UNEXPECTED_ERROR_HE } from "../messages.he";

const GOOGLE_INCOMPLETE_HE = "הכניסה עם גוגל לא הושלמה. נסו שוב.";

const AUTH_ERRORS_HE: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD:
    "המייל או הסיסמה שגויים. נרשמתם עם גוגל? היכנסו בכפתור של גוגל. עוד אין לכם חשבון? בחרו ״הרשמה עם מייל״.",
  INVALID_EMAIL: "הזינו כתובת מייל תקינה.",
  PASSWORD_TOO_SHORT: `הסיסמה צריכה להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים.`,
  PASSWORD_TOO_LONG: "הסיסמה ארוכה מדי.",
  PASSWORD_COMPROMISED: PASSWORD_COMPROMISED_HE,
  INVALID_PASSWORD: "הסיסמה שגויה.",
  INVALID_TOKEN: "הקישור לא תקף או שכבר נעשה בו שימוש. בקשו קישור חדש.",
  TOKEN_EXPIRED: "פג תוקף הקישור. היכנסו עם המייל והסיסמה, ותוכלו לבקש קישור חדש.",
  EMAIL_ALREADY_VERIFIED: "הכתובת כבר אושרה. אפשר להיכנס.",
  VERIFY_FROM_OTHER_SITE: "האישור לא הושלם. פתחו שוב את הקישור מהמייל, הזינו את הסיסמה ולחצו על ״אישור והמשך״.",
  USER_NOT_FOUND: "ההרשמה הזו כבר לא בתוקף. אפשר להירשם מחדש.",
  VERIFICATION_FAILED: "בדיקת האבטחה נכשלה. רעננו את הדף ונסו שוב.",
  MISSING_RESPONSE: "בדיקת האבטחה לא נטענה. רעננו את הדף ונסו שוב, או היכנסו עם גוגל.",
  // Never "confirm the pending email": that sign-up may be a squatter's, with the squatter's password.
  account_not_linked:
    "לכתובת הזו יש הרשמה עם סיסמה שעוד לא אושרה. אם לא אתם נרשמתם, אין מה לדאוג. כדי להמשיך, בחרו סיסמה חדשה, ואחר כך אפשר להיכנס גם עם גוגל.",
  state_mismatch: GOOGLE_INCOMPLETE_HE,
  please_restart_the_process: GOOGLE_INCOMPLETE_HE,
  invalid_code: GOOGLE_INCOMPLETE_HE,
  no_code: GOOGLE_INCOMPLETE_HE,
  unable_to_get_user_info: GOOGLE_INCOMPLETE_HE,
  unable_to_link_account: GOOGLE_INCOMPLETE_HE,
};

// The user chose to cancel at Google; that is not an error to show.
const SILENT_CODES = new Set(["access_denied"]);

const RATE_LIMITED_HE = "יותר מדי ניסיונות. חכו דקה ונסו שוב.";

export interface AuthFailure {
  code?: string;
  status?: number;
  message?: string;
}

export function authErrorMessage(error: AuthFailure | null | undefined): string {
  if (error?.status === 429) return RATE_LIMITED_HE;
  const code = error?.code;
  return code && Object.hasOwn(AUTH_ERRORS_HE, code) ? AUTH_ERRORS_HE[code] : UNEXPECTED_ERROR_HE;
}

// For `?error=` codes that Better Auth puts in redirect URLs.
export function urlErrorMessage(code: unknown): string | null {
  if (typeof code !== "string" || SILENT_CODES.has(code)) return null;
  return authErrorMessage({ code });
}
