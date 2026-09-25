"use client";

import Link from "next/link";
import { formatCredits } from "@/lib/billing/format";
import { TRIAL_CREDITS, TRIAL_DAYS } from "@/lib/billing/pricing";
import { BusinessOffer } from "./pricing/BusinessOffer";
import { PlanGrid } from "./pricing/PlanGrid";
import { TrustPoints } from "./pricing/TrustPoints";

export function Pricing({ ctaHref = "/app" }: { ctaHref?: string }) {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="py-16 sm:py-24">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-4 sm:gap-12 sm:px-6">
        <header className="sd-reveal text-center">
          <p className="mb-3 text-[13px] font-semibold text-terra">מחירים</p>
          <h2 id="pricing-title" className="font-display text-4xl leading-tight text-espresso sm:text-5xl">
            תוכנית לכל קצב
          </h2>
          <p className="mt-4 text-base leading-relaxed text-espresso-light sm:text-lg">
            {TRIAL_DAYS} ימי ניסיון עם {formatCredits(TRIAL_CREDITS)} קרדיטים, בלי כרטיס אשראי. המחירים כוללים מע״מ.
          </p>
        </header>

        <PlanGrid
          align="center"
          renderAction={(_plan, { className }) => (
            <Link href={ctaHref} className={className}>
              מתחילים בחינם
            </Link>
          )}
        />

        <BusinessOffer />
        <TrustPoints />
      </div>
    </section>
  );
}
