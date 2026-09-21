export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_NAME_LENGTH = 40;
export const EMAIL_VERIFICATION_TTL_HOURS = 24;
export const RESET_PASSWORD_TTL_MINUTES = 60;
export const UNVERIFIED_SIGN_UP_MAX_AGE_DAYS = 7;
// Set by our confirm page right before it submits; SameSite=Strict, so no link or redirect chain can carry it.
export const CONFIRM_INTENT_COOKIE = "af_confirm_intent";
