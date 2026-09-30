import type { ReactNode } from "react";
import { PendingLink } from "@/app/app/Pending";
import { WhatsAppChatLink } from "@/components/WhatsAppChatLink";
import { WhatsAppIcon } from "@/components/WhatsAppIcon";
import { BUSINESS_OFFER, PLAN_COPY, WHATSAPP_BUSINESS_SOON } from "@/content/plans.he";
import { PLANS } from "@/lib/billing/pricing";
import { CTA_LABEL } from "./content";
import { NightChat } from "./NightChat";
import { BODY, CONTAINER, FOCUS_NIGHT, H2, MICRO, PRIMARY_BUTTON, SECTION, SMALL } from "./theme";

export function Night() {
  return (
    <section id="business" aria-labelledby="business-title" className={`${SECTION} night-stage text-(--ink)`}>
      <div className={`${CONTAINER} grid gap-12 lg:grid-cols-12 lg:items-center lg:gap-12`}>
        <div className="lg:col-span-6 lg:col-start-1 lg:row-start-1">
          <NightChat />
        </div>
        <div className="lg:col-span-6 lg:col-start-7">
          <p className={`${SMALL} font-bold text-terra-light`}>לבעלי עסקים</p>
          <h2 id="business-title" className={`${H2} mt-3`}>
            עונה ללקוחות שלכם, גם ב-23:40.
          </h2>
          <p className={`${BODY} mt-5 max-w-[30rem] text-pretty text-(--ink-2)`}>
            הסוכן עונה על שאלות של לקוחות בשם העסק, בכל שעה. אפשר להוסיף אותו גם לקבוצת העבודה, והוא מתאים את עצמו להקשר ועוזר לכולם בקבוצה.
          </p>

          <dl className="mt-8 divide-y divide-(--night-line) border-y border-(--night-line)">
            <Fact term="עובד היום">בטלגרם, או בוואטסאפ עם מספר ייעודי לסוכן.</Fact>
            {WHATSAPP_BUSINESS_SOON ? (
              <Fact term="וואטסאפ לעסקים">
                <span className={`${MICRO} me-2 rounded-full border border-terra/50 bg-terra/10 px-2 py-0.5 font-bold text-terra-light`}>בקרוב</span>
                חיבור למספר העסקי שלכם דרך מטא, בתוכנית {PLANS.pro.name}.
              </Fact>
            ) : null}
            <Fact term={`תוכנית ${PLANS.standard.name}`}>
              {PLAN_COPY.standard.tagline}, {PLANS.standard.priceIls} ש״ח לחודש.
            </Fact>
          </dl>

          <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
            <PendingLink href="/app" className={`${PRIMARY_BUTTON} w-full sm:w-auto`}>
              {CTA_LABEL}
            </PendingLink>
            <WhatsAppChatLink text={BUSINESS_OFFER.whatsappText} className={`${SMALL} inline-flex items-center gap-2 font-semibold text-(--ink) underline decoration-terra-light/50 underline-offset-4 hover:decoration-terra-light ${FOCUS_NIGHT}`}>
              <WhatsAppIcon className="h-4 w-4 text-wa-green" />
              {BUSINESS_OFFER.cta} על תוכנית לעסקים
            </WhatsAppChatLink>
          </div>
        </div>
      </div>
    </section>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-4 sm:grid-cols-[9rem_1fr] sm:gap-5">
      <dt className={`${SMALL} font-bold text-(--ink)`}>{term}</dt>
      <dd className={`${SMALL} text-(--ink-2)`}>{children}</dd>
    </div>
  );
}
