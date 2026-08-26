import { createHash } from "node:crypto";

// Plus-tags and (for Gmail) dots are free aliases of one mailbox; folding them keeps one trial per person.
export function trialClaimKey(email: string): string {
  const [rawLocal = "", rawDomain = ""] = email.trim().toLowerCase().split("@");
  const domain = rawDomain === "googlemail.com" ? "gmail.com" : rawDomain;
  const local = rawLocal.split("+")[0] ?? "";
  const folded = domain === "gmail.com" ? local.replace(/\./g, "") : local;
  return createHash("sha256").update(`${folded}@${domain}`, "utf8").digest("hex");
}
