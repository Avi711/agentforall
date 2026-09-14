import { PendingLink } from "./Pending";
import type { OutOfCreditsReason } from "@/lib/billing/credits/service";
import type { CreditsAction } from "@/lib/billing/service";
import { SITE_WHATSAPP_URL } from "@/lib/site";

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

const ACTION_HREF: Record<CreditsAction, string> = {
  topup: "/app/settings#credits",
  subscribe: "/app/settings#billing",
  contact: `${SITE_WHATSAPP_URL}?text=${encodeURIComponent("היי, הסוכן שלי לא עונה כי נגמרו הקרדיטים")}`,
};

export function CreditsActionLink({ action, className }: { action: CreditsAction; className?: string }) {
  if (action === "contact") {
    return (
      <a href={ACTION_HREF.contact} target="_blank" rel="noopener noreferrer" className={className}>
        {ACTION_LABEL.contact}
      </a>
    );
  }
  return (
    <PendingLink href={ACTION_HREF[action]} className={className}>
      {ACTION_LABEL[action]}
    </PendingLink>
  );
}
