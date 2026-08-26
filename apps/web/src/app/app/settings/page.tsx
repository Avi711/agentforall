import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { getBillingService } from "@/lib/billing";
import { CheckoutSessionQuerySchema } from "@/lib/billing/schemas";
import { isCheckoutReturn } from "@/lib/billing/urls";
import { toBillingUser } from "@/lib/billing/user";
import { BillingCard } from "./BillingCard";
import { CreditsCard } from "./CreditsCard";
import { DeleteAccountCard } from "./DeleteAccountCard";
import { OrnamentDivider } from "../Marks";

export const metadata: Metadata = {
  title: "הגדרות — Agent For All",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession("/login");
  const params = await searchParams;
  const billing = await getBillingService().refreshStatus(toBillingUser(session.user));
  const checkoutResult = isCheckoutReturn(params.checkout) ? params.checkout : null;
  const returned = CheckoutSessionQuerySchema.safeParse(params);
  const checkoutSessionId = checkoutResult && returned.success ? returned.data.session : null;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-28 space-y-8 sm:space-y-10">
      <header>
        <p className="text-xs uppercase tracking-[0.22em] text-espresso-light/80 mb-3">חשבון</p>
        <h1 className="font-display text-4xl sm:text-5xl text-espresso leading-tight">הגדרות</h1>
        <div className="mt-5 flex items-center gap-4">
          <OrnamentDivider />
          <p className="text-espresso-light text-sm">ניהול החשבון שלכם.</p>
        </div>
      </header>

      <section className="relative bg-white rounded-[24px] border border-sand-light shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] p-5 sm:p-10 overflow-hidden">
        <span aria-hidden className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-sand-light to-transparent" />
        <p className="text-[11px] uppercase tracking-[0.22em] text-espresso-light/70 mb-2">פרטי חשבון</p>
        <h2 className="font-display text-2xl text-espresso mb-6 leading-tight">מי אתם</h2>
        <dl className="divide-y divide-sand-light/70">
          <Row label="שם" value={session.user.name ?? "—"} />
          <Row label="אימייל" value={session.user.email} dir="ltr" />
        </dl>
      </section>

      <BillingCard initial={billing} checkoutResult={checkoutResult} checkoutSessionId={checkoutSessionId} />

      <CreditsCard status={billing} />

      <DeleteAccountCard />
    </div>
  );
}

function Row({ label, value, dir }: { label: string; value: string; dir?: "ltr" }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 py-3.5 first:pt-0 last:pb-0">
      <dt className="text-xs uppercase tracking-[0.18em] text-espresso-light/80 sm:w-28 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 text-espresso text-sm break-words" dir={dir}>
        {value}
      </dd>
    </div>
  );
}
