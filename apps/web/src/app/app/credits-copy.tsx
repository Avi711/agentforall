import { WhatsAppChatLink } from "@/components/WhatsAppChatLink";
import type { CreditPool } from "@/lib/billing/credits/pools";
import type { OutOfCreditsReason } from "@/lib/billing/credits/service";
import type { CreditGrantKind } from "@/lib/billing/domain";
import type { CreditsAction } from "@/lib/billing/service";
import { settingsSectionHref } from "@/lib/billing/urls";
import { PendingLink } from "./Pending";

export const OUT_OF_CREDITS_LABEL: Record<OutOfCreditsReason, string> = {
  "trial-ended": "תקופת הניסיון הסתיימה",
  "plan-ended": "תקופת המנוי הסתיימה",
  "credits-spent": "הקרדיטים נגמרו",
};

export const BALANCE_NOTE = {
  low: "הקרדיטים עומדים להיגמר. כשהם נגמרים הסוכן מפסיק לענות.",
  out: "הסוכן לא עונה עד שיהיו קרדיטים.",
} as const;

export const POOL_SOURCE: Record<CreditGrantKind, string> = { plan: "מהתוכנית", trial: "מהניסיון", topup: "מטעינות" };
const POOL_SWATCH: Record<CreditGrantKind, string> = { plan: "bg-sage", trial: "bg-sage-light", topup: "bg-honey" };

export function poolSwatch(pool: CreditPool, alert: boolean): string {
  return alert && pool.validUntil !== null ? "bg-terra" : POOL_SWATCH[pool.kind];
}

const ACTION_LABEL: Record<CreditsAction, string> = {
  topup: "טעינת קרדיטים",
  subscribe: "הצטרפות למנוי",
  contact: "דברו איתנו בוואטסאפ",
};

const ACTION_HREF: Record<Exclude<CreditsAction, "contact">, string> = {
  topup: settingsSectionHref("topup"),
  subscribe: settingsSectionHref("plans"),
};

export function daysLeftLabel(days: number): string {
  return days <= 1 ? "נותר יום אחד" : `נותרו ${days} ימים`;
}

export function runwayLabel(days: number): string {
  if (days === 0) return "בקצב הנוכחי הקרדיטים ייגמרו היום";
  return days === 1 ? "בקצב הנוכחי הקרדיטים ייגמרו מחר" : `בקצב הנוכחי הקרדיטים ייגמרו בעוד כ־${days} ימים`;
}

export function CreditsActionLink({ action, className }: { action: CreditsAction; className?: string }) {
  if (action === "contact") {
    return (
      <WhatsAppChatLink text="היי, הסוכן שלי לא עונה כי נגמרו הקרדיטים" className={className}>
        {ACTION_LABEL.contact}
      </WhatsAppChatLink>
    );
  }
  return (
    <PendingLink href={ACTION_HREF[action]} className={className}>
      {ACTION_LABEL[action]}
    </PendingLink>
  );
}
