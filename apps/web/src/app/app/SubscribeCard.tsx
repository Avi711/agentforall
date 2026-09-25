"use client";

import { ErrorAlert } from "@/components/ErrorAlert";
import { WhatsAppChatLink } from "@/components/WhatsAppChatLink";
import type { PlanCode } from "@/lib/billing/pricing";
import type { BillingStatus } from "@/lib/billing/service";
import { SETTINGS_PATH } from "@/lib/billing/urls";
import { startCheckout } from "./billing/client";
import { PlanCheckout } from "./billing/PlanCheckout";
import { SurfaceCard } from "./Marks";
import { PendingLink } from "./Pending";
import { useActionRunner } from "./useActionRunner";
import { CATALOG_SIZE_LABEL, LANDING_APPS } from "@/lib/integrations/catalog.he";

const PERKS = [
  "סוכן AI פרטי משלכם, זמין 24/7 בוואטסאפ או בטלגרם",
  "מבצע בפועל: מזיז פגישות, שולח הודעות, מכין קבצים ודוחות",
  `מחובר לאפליקציות שלכם: Gmail, יומן Google, Drive, Notion, monday, Google Ads, Meta Ads ועוד מעל ${CATALOG_SIZE_LABEL}`,
  "זיכרון, תזכורות, אוטומציות קבועות ומעקבי מחירים ותורים",
  "מבין הודעות קוליות ועונה בעברית רהוטה",
  "ביטול בכל רגע, בלי התחייבות",
];

const LOGO_SLUGS = ["gmail", "googlecalendar", "googledrive", "notion", "monday", "googleads", "metaads"];
const LOGOS = LANDING_APPS.filter((app) => LOGO_SLUGS.includes(app.slug));

export function SubscribeCard({ status }: { status: BillingStatus }) {
  const checkout = useActionRunner<PlanCode>();
  return (
    <SurfaceCard className="p-6 sm:p-10">
      <p className="text-[11px] uppercase tracking-[0.22em] text-espresso-light/70 mb-2">מנוי</p>
      <h2 className="font-display text-2xl sm:text-3xl text-espresso leading-tight mb-3">כדי להעלות סוכן צריך מנוי פעיל</h2>
      <ul className="space-y-2.5 mb-6">
        {PERKS.map((perk) => (
          <li key={perk} className="flex items-start gap-3 text-sm text-espresso">
            <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full bg-terra shrink-0" />
            <span>{perk}</span>
          </li>
        ))}
      </ul>

      <div className="mb-6 flex flex-wrap items-center gap-2" aria-hidden>
        {LOGOS.map((app) => (
          <img key={app.slug} src={app.logo} alt="" width={24} height={24} className="h-6 w-6" />
        ))}
        <span dir="ltr" className="rounded-full bg-cream-dark px-2.5 py-0.5 text-xs text-espresso-light">{CATALOG_SIZE_LABEL}+</span>
      </div>

      {status.available ? (
        <PlanCheckout
          pendingPlan={checkout.pending}
          disabled={checkout.pending !== null}
          onChoose={(code) => checkout.redirect(code, () => startCheckout(code))}
        />
      ) : (
        <p className="text-sm text-espresso-light">
          התשלומים ייפתחו בקרוב. רוצים להתחיל כבר עכשיו?{" "}
          <WhatsAppChatLink text="היי, אני רוצה להעלות סוכן" className="underline hover:text-terra">
            דברו איתנו בוואטסאפ
          </WhatsAppChatLink>
        </p>
      )}

      <ErrorAlert className="mt-4">{checkout.error}</ErrorAlert>

      <p className="mt-6 text-xs text-espresso-light">
        כבר שילמתם?{" "}
        <PendingLink href={SETTINGS_PATH} className="underline hover:text-terra">
          בדקו את מצב המנוי בהגדרות
        </PendingLink>
      </p>
    </SurfaceCard>
  );
}
