import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { getBillingService } from "@/lib/billing";
import { toBillingUser } from "@/lib/billing/user";
import { ScrollToHashTarget } from "../ScrollToHashTarget";
import { BillingSection } from "./BillingSection";
import { DeleteAccount } from "./DeleteAccount";
import { PageSection } from "./Section";

export const metadata: Metadata = {
  title: "הגדרות — Agent For All",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession("/login");
  const billing = await getBillingService().refreshStatus(toBillingUser(session.user));

  return (
    <div className="mx-auto max-w-3xl px-4 pb-28 pt-6 sm:px-6 sm:pt-10">
      <h1 className="mb-5 font-display text-2xl leading-tight text-espresso sm:mb-6 sm:text-3xl">הגדרות</h1>
      <div className="flex flex-col gap-10 sm:gap-12">
        <BillingSection initial={billing} />

        <PageSection id="account" title="חשבון">
          <dl className="divide-y divide-sand-light/70">
            <Row label="שם" value={session.user.name ?? "—"} />
            <Row label="אימייל" value={session.user.email} />
          </dl>
          <DeleteAccount subscribed={billing.paid} credits={billing.credits.available} topupCredits={billing.credits.topupAvailable} />
        </PageSection>
      </div>
      <ScrollToHashTarget />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] items-baseline gap-4 py-3.5 sm:grid-cols-[7rem_1fr]">
      <dt className="text-sm text-espresso-light">{label}</dt>
      <dd className="min-w-0 break-words text-[15px] text-espresso">
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}
