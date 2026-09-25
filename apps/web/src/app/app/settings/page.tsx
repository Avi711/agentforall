import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { getBillingService } from "@/lib/billing";
import { CheckoutSessionQuerySchema } from "@/lib/billing/schemas";
import { isCheckoutReturn } from "@/lib/billing/urls";
import { toBillingUser } from "@/lib/billing/user";
import { SurfaceCard } from "../Marks";
import { BillingSection } from "./BillingSection";
import { DeleteAccountCard } from "./DeleteAccountCard";

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
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 pb-28 pt-10 sm:gap-8 sm:px-6 sm:pt-14">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl leading-tight text-espresso sm:text-5xl">הגדרות</h1>
        <p className="text-base text-espresso-light">המנוי, הקרדיטים והחשבון שלכם.</p>
      </header>

      <BillingSection initial={billing} checkoutResult={checkoutResult} checkoutSessionId={checkoutSessionId} />

      <SurfaceCard className="px-6 py-2 sm:px-8">
        <h2 className="sr-only">פרטי חשבון</h2>
        <dl className="divide-y divide-sand-light/70">
          <Row label="שם" value={session.user.name ?? "—"} />
          <Row label="אימייל" value={session.user.email} dir="ltr" />
        </dl>
      </SurfaceCard>

      <DeleteAccountCard />
    </div>
  );
}

function Row({ label, value, dir }: { label: string; value: string; dir?: "ltr" }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <dt className="text-sm text-espresso-light">{label}</dt>
      <dd className="min-w-0 break-words text-[15px] text-espresso" dir={dir}>
        {value}
      </dd>
    </div>
  );
}
