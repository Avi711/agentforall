import Link from "next/link";
import { formatCredits, formatIls } from "@/lib/billing/format";
import {
  DEFAULT_PLAN,
  PLAN_CATALOGUE,
  TOPUP_MIN_ILS,
  TOPUP_TERMS,
  TRIAL_CREDITS,
  TRIAL_DAYS,
  estimatedMessages,
} from "@/lib/billing/pricing";

// `/app` redirects a signed-out visitor to login and lands a signed-in one on the dashboard.
export function Pricing({ ctaHref = "/app" }: { ctaHref?: string }) {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="py-16 sm:py-24">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <header className="text-center mb-10 sm:mb-14">
          <p className="text-xs uppercase tracking-[0.22em] text-espresso-light/80 mb-3">מחירים</p>
          <h2 id="pricing-title" className="font-display text-3xl sm:text-4xl text-espresso leading-tight">
            תוכנית לכל קצב
          </h2>
          <p className="mt-4 text-espresso-light text-sm sm:text-base leading-relaxed">
            מתחילים עם {formatCredits(TRIAL_CREDITS)} קרדיטים ל-{TRIAL_DAYS} ימים, בלי כרטיס אשראי. כל המחירים כוללים מע״מ.
          </p>
        </header>

        <div className="grid gap-4 sm:gap-6 sm:grid-cols-3">
          {PLAN_CATALOGUE.map((plan) => {
            const featured = plan.code === DEFAULT_PLAN;
            return (
              <article
                key={plan.code}
                className={`relative flex flex-col rounded-[24px] border bg-white p-6 sm:p-8 ${
                  featured ? "border-terra shadow-[0_24px_60px_-32px_rgba(199,84,42,0.35)]" : "border-sand-light"
                }`}
              >
                {featured ? (
                  <span className="absolute -top-3 inset-x-0 mx-auto w-fit rounded-full bg-terra px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-white">
                    הכי פופולרי
                  </span>
                ) : null}
                <h3 className="font-display text-xl text-espresso">{plan.name}</h3>
                <p className="mt-3 text-4xl text-espresso tabular-nums" dir="ltr">
                  {formatIls(plan.priceIls)}
                  <span className="text-sm text-espresso-light"> / חודש</span>
                </p>
                <ul className="mt-6 space-y-2.5 text-sm text-espresso flex-1">
                  <Perk>{formatCredits(plan.includedCredits)} קרדיטים בחודש</Perk>
                  <Perk>≈ {formatCredits(estimatedMessages(plan.includedCredits))} הודעות</Perk>
                  <Perk>סוכן פרטי משלכם, 24/7</Perk>
                  <Perk>וואטסאפ או טלגרם</Perk>
                  <Perk>ביטול בכל רגע</Perk>
                </ul>
                <Link
                  href={ctaHref}
                  className={`mt-8 inline-flex justify-center rounded-lg px-5 py-3 text-sm font-medium transition ${
                    featured ? "bg-terra text-white hover:bg-terra-dark" : "border border-sand text-espresso hover:bg-cream-dark"
                  }`}
                >
                  רוצה סוכן
                </Link>
              </article>
            );
          })}
        </div>

        <p className="mt-8 text-center text-xs sm:text-sm text-espresso-light">
          נגמרו הקרדיטים? טוענים מ-{formatIls(TOPUP_MIN_ILS)} (₪1 = {TOPUP_TERMS.creditsPerIls} קרדיטים). טעינות לא פגות.
        </p>
      </div>
    </section>
  );
}

function Perk({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden className="mt-2 w-1.5 h-1.5 rounded-full bg-terra shrink-0" />
      <span>{children}</span>
    </li>
  );
}
