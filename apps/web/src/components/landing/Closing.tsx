import Link from "next/link";
import { PendingLink } from "@/app/app/Pending";
import { OperatorLine } from "@/components/OperatorLine";
import { WhatsAppChatLink } from "@/components/WhatsAppChatLink";
import { PLANS } from "@/lib/billing/pricing";
import { CTA_LABEL, NAV_LINKS, TRIAL_NOTE, WHATSAPP_ASK } from "./content";
import { Wordmark } from "./Header";
import { ArrowForward } from "./marks";
import { CONTAINER, DISPLAY, MICRO, NAV_LINK, PRIMARY_BUTTON, SMALL, TEXT_LINK } from "./theme";

export function FinalCta() {
  return (
    <section data-final-cta="" aria-labelledby="final-title" className="border-t border-(--line) bg-(--surface)">
      <div className={`${CONTAINER} flex flex-col items-stretch gap-8 py-20 sm:items-start sm:py-28 lg:flex-row lg:items-end lg:justify-between`}>
        <h2 id="final-title" className={`${DISPLAY} max-w-[16ch]`}>
          תנו לו את <span className="text-(--accent-ink)">המשימה הראשונה.</span>
        </h2>
        <div className="flex flex-col gap-3 lg:items-end">
          <PendingLink href="/app" className={`${PRIMARY_BUTTON} w-full sm:w-auto`}>
            {CTA_LABEL}
            <ArrowForward className="h-5 w-5" />
          </PendingLink>
          <p className={`${SMALL} text-center font-semibold text-(--ink) sm:text-start`}>{TRIAL_NOTE}</p>
        </div>
      </div>
    </section>
  );
}

const LEGAL_LINKS = [
  { label: "תנאי שימוש", href: "/terms" },
  { label: "מדיניות פרטיות", href: "/privacy" },
  { label: "מדיניות החזרים", href: "/refund" },
  { label: "הצהרת נגישות", href: "/accessibility" },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-(--line) bg-(--page) pb-(--a11y-clearance)">
      <div className={`${CONTAINER} grid grid-cols-2 gap-8 py-12 sm:grid-cols-[1.5fr_1fr_1fr] sm:gap-10`}>
        <div className="col-span-2 sm:col-span-1">
          <Wordmark />
          <p className={`${SMALL} mt-3 max-w-xs text-(--ink-2)`}>סוכן אישי בוואטסאפ ובטלגרם. מ-{PLANS.basic.priceIls} ש״ח לחודש.</p>
          <WhatsAppChatLink className={`${SMALL} mt-3 inline-block ${TEXT_LINK}`}>{WHATSAPP_ASK}</WhatsAppChatLink>
        </div>
        <nav aria-labelledby="footer-product">
          <h3 id="footer-product" className={`${SMALL} mb-3 font-bold text-(--ink)`}>
            המוצר
          </h3>
          <ul className={`${SMALL} space-y-2.5`}>
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} className={NAV_LINK}>
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <Link href="/blog" className={NAV_LINK}>
                בלוג
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-labelledby="footer-legal">
          <h3 id="footer-legal" className={`${SMALL} mb-3 font-bold text-(--ink)`}>
            משפטי
          </h3>
          <ul className={`${SMALL} space-y-2.5`}>
            {LEGAL_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={NAV_LINK}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className={`${CONTAINER} ${MICRO} flex flex-col gap-2 border-t border-(--line) py-6 text-(--ink-2) sm:flex-row sm:items-center sm:justify-between`}>
        <p>
          &copy; {new Date().getFullYear()} <bdi>Agent For All</bdi>. כל הזכויות שמורות.
        </p>
        <p>
          <OperatorLine />
        </p>
        <p>תמיכה בעברית · שירות ישראלי</p>
      </div>
    </footer>
  );
}
