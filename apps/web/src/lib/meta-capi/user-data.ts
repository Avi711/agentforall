import {
  deriveFbcFromUrl,
  normalizeEmail,
  normalizeIsraeliPhone,
  normalizeName,
  sha256Hex,
  splitName,
} from "./normalize";

export interface UserDataInput {
  email?: string;
  phone?: string;
  name?: string;
  // Stable caller-owned identifier. Caller is responsible for normalization.
  externalId?: string;
  clientIp?: string;
  userAgent?: string;
  fbp?: string;
  fbc?: string;
  eventSourceUrl?: string;
}

export interface UserData {
  em?: string[];
  ph?: string[];
  fn?: string[];
  ln?: string[];
  external_id?: string[];
  client_ip_address?: string;
  client_user_agent?: string;
  fbp?: string;
  fbc?: string;
}

const MATCH_FIELDS = ["em", "ph", "fn", "ln", "external_id", "fbp", "fbc"] as const;

export function buildUserData(input: UserDataInput): UserData {
  const ud: UserData = {};

  const email = input.email ? normalizeEmail(input.email) : null;
  if (email) ud.em = [sha256Hex(email)];

  const phone = input.phone ? normalizeIsraeliPhone(input.phone) : null;
  if (phone) ud.ph = [sha256Hex(phone)];

  if (input.name) {
    const { fn, ln } = splitName(input.name);
    const fnNorm = fn ? normalizeName(fn) : null;
    const lnNorm = ln ? normalizeName(ln) : null;
    if (fnNorm) ud.fn = [sha256Hex(fnNorm)];
    if (lnNorm) ud.ln = [sha256Hex(lnNorm)];
  }

  if (input.externalId) ud.external_id = [sha256Hex(input.externalId)];

  if (input.clientIp) ud.client_ip_address = input.clientIp;
  if (input.userAgent) ud.client_user_agent = input.userAgent;
  if (input.fbp) ud.fbp = input.fbp;

  const fbc = input.fbc ?? deriveFbcFromUrl(input.eventSourceUrl) ?? undefined;
  if (fbc) ud.fbc = fbc;

  return ud;
}

// Meta requires at least one identifying signal — plain IP + UA do not count
// as matchable identity.
export function hasMatchableIdentifier(ud: UserData): boolean {
  return MATCH_FIELDS.some((key) => ud[key] !== undefined);
}
