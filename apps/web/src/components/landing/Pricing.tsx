"use client";

import { useState } from "react";
import { PendingLink } from "@/app/app/Pending";
import { CheckIcon } from "@/components/blog/icons";
import { WhatsAppChatLink } from "@/components/WhatsAppChatLink";
import { WhatsAppIcon } from "@/components/WhatsAppIcon";
import { BUSINESS_OFFER, CANCEL_ANYTIME, PLAN_COPY, PLAN_TRUST_POINTS } from "@/content/plans.he";
import { formatCredits, formatIls, intervalAdjective } from "@/lib/billing/format";
import {
  BILLING_INTERVALS,
  PLAN_CATALOGUE,
  PLANS,
  TOPUP_MIN_ILS,
  TRIAL_DAYS,
  YEARLY_DISCOUNT_PERCENT,
  isRecommendedPlan,
  monthlyCredits,
  monthlyPriceIls,
  yearlySavingsIls,
  type BillingInterval,
  type Plan,
} from "@/lib/billing/pricing";
import Link from "next/link";
import { CTA_LABEL, TRIAL_DETAIL, TRIAL_END } from "./content";
import { BODY, CARD, CONTAINER, EYEBROW, FOCUS, H2, H3, MICRO, PRICE, PRIMARY_BUTTON, QUIET_BUTTON, SECTION, SMALL, TEXT_LINK } from "./theme";

const MONTHLY_NOTE = `חיוב ${intervalAdjective("month")} · ${CANCEL_ANYTIME}`;

export function Pricing() {
  const [billing, setBilling] = useState<BillingInterval>("month");
  const plans = PLAN_CATALOGUE.filter((plan) => plan.interval === billing);

  return (
    <section id="pricing" aria-labelledby="pricing-title" className={`${SECTION} border-t border-(--line)`}>
      <div className={CONTAINER}>
        <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <p className={EYEBROW}>מחירים</p>
            <h2 id="pricing-title" className={`${H2} mt-3`}>
              {TRIAL_DAYS} ימים בחינם. אחר כך מ-{PLANS.basic.priceIls} ש״ח לחודש.
            </h2>
            <p className={`${BODY} mt-4 max-w-[38rem] text-pretty text-(--ink-2)`}>
              {TRIAL_DETAIL} {TRIAL_END}
            </p>
          </div>
          <div className="lg:col-span-4 lg:justify-self-end">
            <IntervalToggle value={billing} onChange={setBilling} />
          </div>
        </div>

        <div className="mx-auto mt-10 grid max-w-[560px] gap-4 lg:max-w-none lg:grid-cols-3 lg:items-stretch lg:gap-5">
          {plans.map((plan) => (
            <PlanCard key={plan.tier} plan={plan} featured={isRecommendedPlan(plan)} />
          ))}
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-12 lg:gap-10">
          <p className={`${SMALL} max-w-[42rem] text-pretty text-(--ink-2) lg:col-span-7`}>
            כל פעולה של הסוכן עולה קרדיטים לפי כמה עבודה היא דורשת. נגמרו באמצע החודש? טוענים עוד מ-{TOPUP_MIN_ILS} ש״ח, והטעינות לא פגות.
          </p>
          <ul className={`${SMALL} flex flex-col gap-2 font-semibold text-(--ink) lg:col-span-5`}>
            {PLAN_TRUST_POINTS.map((point) => (
              <li key={point} className="flex items-start gap-2">
                <CheckIcon className="mt-1 h-4 w-4 shrink-0 text-(--good)" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <p className={`${MICRO} mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-(--ink-2)`}>
          <span>תמיכה בעברית · שירות ישראלי</span>
          <span aria-hidden="true">·</span>
          <span>מחיקת החשבון בכל רגע מההגדרות</span>
          <span aria-hidden="true">·</span>
          <Link href="/privacy" className={TEXT_LINK}>
            מדיניות פרטיות
          </Link>
        </p>

        <div className={`${CARD} mt-10 flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7`}>
          <div>
            <h3 className={H3}>
              {BUSINESS_OFFER.title} <span className={`${SMALL} font-normal text-(--ink-2)`}>· {BUSINESS_OFFER.note}</span>
            </h3>
            <p className={`${SMALL} mt-1.5 text-(--ink-2)`}>{BUSINESS_OFFER.points.join(" · ")}</p>
          </div>
          <WhatsAppChatLink text={BUSINESS_OFFER.whatsappText} className={`${QUIET_BUTTON} shrink-0`}>
            <WhatsAppIcon className="h-5 w-5 text-wa-teal" />
            {BUSINESS_OFFER.cta}
          </WhatsAppChatLink>
        </div>
      </div>
    </section>
  );
}

function IntervalToggle({ value, onChange }: { value: BillingInterval; onChange: (interval: BillingInterval) => void }) {
  return (
    <div role="group" aria-label="תדירות חיוב" className="inline-flex rounded-full border border-(--line) bg-(--surface) p-1">
      {BILLING_INTERVALS.map((interval) => {
        const active = interval === value;
        return (
          <button
            key={interval}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(interval)}
            className={`${SMALL} min-h-11 whitespace-nowrap rounded-full px-5 font-semibold transition-colors ${FOCUS} ${active ? "bg-(--ink) text-(--page)" : "text-(--ink-2) hover:text-(--ink)"}`}
          >
            {intervalAdjective(interval)}
            {interval === "year" ? <span className={active ? "text-(--accent-on-ink)" : "text-(--accent-ink)"}> · {YEARLY_DISCOUNT_PERCENT}% הנחה</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function PlanCard({ plan, featured }: { plan: Plan; featured: boolean }) {
  const copy = PLAN_COPY[plan.tier];
  return (
    <article className={`${CARD} relative flex flex-col gap-5 p-5 sm:p-7 ${featured ? "border-terra-strong ring-1 ring-terra-strong" : ""}`}>
      <header>
        <div className="flex items-center justify-between gap-3">
          <h3 className={H3}>{plan.name}</h3>
          {featured ? <span className={`${MICRO} rounded-full bg-terra-strong px-2.5 py-1 font-bold text-white`}>מומלץ</span> : null}
        </div>
        <p className={`${SMALL} mt-1 text-(--ink-2)`}>{copy.tagline}</p>
      </header>

      <div>
        <p className="flex items-baseline gap-1.5">
          <bdi dir="ltr" className={PRICE}>{formatIls(monthlyPriceIls(plan))}</bdi>
          <span className={`${SMALL} text-(--ink-2)`}>לחודש</span>
        </p>
        <p className={`${MICRO} mt-2 min-h-5 text-(--ink-2)`}>
          {plan.interval === "year" ? (
            <>
              <bdi dir="ltr">{formatIls(plan.priceIls)}</bdi> לשנה בחיוב אחד · <span className="font-bold text-(--good)">חוסכים <bdi dir="ltr">{formatIls(yearlySavingsIls(plan.tier))}</bdi></span>
            </>
          ) : (
            MONTHLY_NOTE
          )}
        </p>
      </div>

      <p className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="tabular-nums text-[17px] font-bold text-(--ink)">{formatCredits(monthlyCredits(plan))}</span>
        <span className={`${SMALL} text-(--ink-2)`}>קרדיטים בחודש</span>
      </p>

      <PendingLink href="/app" className={`${featured ? PRIMARY_BUTTON : QUIET_BUTTON} w-full`}>
        {CTA_LABEL}
      </PendingLink>

      <ul className={`${SMALL} flex flex-col gap-2.5 border-t border-(--line) pt-5 text-(--ink)`}>
        {copy.highlights.map((highlight) => (
          <li key={highlight} className="flex items-start gap-2.5">
            <CheckIcon className="mt-1 h-4 w-4 shrink-0 text-(--good)" />
            {highlight}
          </li>
        ))}
      </ul>
    </article>
  );
}
