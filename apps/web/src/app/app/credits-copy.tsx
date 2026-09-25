import { WhatsAppChatLink } from "@/components/WhatsAppChatLink";
import type { OutOfCreditsReason } from "@/lib/billing/credits/service";
import type { CreditsAction } from "@/lib/billing/service";
import { settingsSectionHref } from "@/lib/billing/urls";
import { PendingLink } from "./Pending";

export const OUT_OF_CREDITS_LABEL: Record<OutOfCreditsReason, string> = {
  "trial-ended": "תקופת הניסיון הסתיימה",
  "plan-ended": "תקופת המנוי הסתיימה",
  "credits-spent": "הקרדיטים נגמרו",
};

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
  return days === 1 ? "בקצב שלכם יספיקו ליום נוסף בערך" : `בקצב שלכם יספיקו לעוד כ־${days} ימים`;
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
