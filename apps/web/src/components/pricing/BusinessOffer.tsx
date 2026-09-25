import { BUSINESS_OFFER } from "@/content/plans.he";
import { WhatsAppChatLink } from "../WhatsAppChatLink";
import { WhatsAppIcon } from "../WhatsAppIcon";
import { CheckIcon } from "./CheckIcon";
import { DARK_ACTION } from "./styles";

export function BusinessOffer() {
  return (
    <section
      aria-label={BUSINESS_OFFER.title}
      className="flex flex-col gap-5 rounded-3xl border border-sand-light bg-cream-dark p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8"
    >
      <div className="flex flex-col gap-3">
        <p className="flex items-baseline gap-3">
          <span className="font-display text-2xl text-espresso sm:text-[28px]">{BUSINESS_OFFER.title}</span>
          <span className="text-sm text-espresso-light">{BUSINESS_OFFER.note}</span>
        </p>
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[15px] text-espresso">
          {BUSINESS_OFFER.points.map((point) => (
            <li key={point} className="flex items-center gap-2">
              <CheckIcon className="h-4 w-4 text-terra" />
              {point}
            </li>
          ))}
        </ul>
      </div>
      <WhatsAppChatLink text={BUSINESS_OFFER.whatsappText} className={`${DARK_ACTION} shrink-0`}>
        <WhatsAppIcon className="h-5 w-5" />
        {BUSINESS_OFFER.cta}
      </WhatsAppChatLink>
    </section>
  );
}
