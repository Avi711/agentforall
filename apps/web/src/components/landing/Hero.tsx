import { PendingLink } from "@/app/app/Pending";
import { CTA_LABEL, TRIAL_NOTE } from "./content";
import { HeroDemo } from "./demo/HeroDemo";
import { ArrowForward, ChannelBadges } from "./marks";
import { BODY, CONTAINER, DISPLAY, PRIMARY_BUTTON, QUIET_BUTTON, SMALL } from "./theme";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="pb-12 pt-6 sm:pt-12 lg:pb-16 lg:pt-14">
      <div className={`${CONTAINER} grid gap-10 lg:grid-cols-12 lg:items-center lg:gap-8`}>
        <div className="lg:col-span-7">
          <p className={`${SMALL} inline-flex items-center gap-2.5 rounded-full border border-(--line) bg-(--surface) py-1.5 pe-4 ps-2 font-semibold text-(--ink)`}>
            <ChannelBadges />
            סוכן אישי משלכם
          </p>
          <h1 id="hero-title" className={`${DISPLAY} mt-6`}>
            <span className="block">כותבים לו בוואטסאפ.</span>
            <span className="block text-(--accent-ink)">הוא כבר מסדר את זה.</span>
          </h1>
          <p className={`${BODY} mt-6 max-w-[30rem] text-pretty text-(--ink-2) sm:text-[19px]`}>
            מזיז פגישות ביומן, מכין אקסל לרו״ח, עוקב אחרי מחיר הטיסה ועונה ללקוחות של העסק. בטלגרם או בוואטסאפ, בלי להתקין כלום.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <PendingLink href="/app" data-hero-cta="" className={`${PRIMARY_BUTTON} w-full sm:w-auto`}>
              {CTA_LABEL}
              <ArrowForward className="h-5 w-5" />
            </PendingLink>
            <a href="#day" className={`${QUIET_BUTTON} max-sm:hidden`}>
              מה הוא עושה
            </a>
          </div>
          <p className={`${SMALL} mt-3 flex items-center justify-center gap-2 font-semibold text-(--ink) sm:justify-start`}>
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-sage" />
            {TRIAL_NOTE}
          </p>
        </div>
        <div className="lg:col-span-5 lg:justify-self-start">
          <HeroDemo />
        </div>
      </div>
    </section>
  );
}
