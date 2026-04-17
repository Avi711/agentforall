import { InteractiveChat } from "./InteractiveChat";
import { WhatsAppIcon } from "./WhatsAppIcon";

export function Hero() {
  return (
    <section className="grain relative overflow-hidden px-5 pt-24 pb-16 sm:px-8 sm:pt-32 sm:pb-20">
      {/* Background shapes */}
      <div className="absolute top-[-200px] right-[-100px] -z-10 h-[500px] w-[500px] rounded-full bg-terra-pale opacity-60 blur-3xl" />
      <div className="absolute bottom-[-100px] left-[-150px] -z-10 h-[400px] w-[400px] rounded-full bg-sage-pale opacity-50 blur-3xl" />

      <div className="mx-auto max-w-6xl">
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20">
          {/* Copy */}
          <div className="animate-fade-up text-center lg:text-start">
            <h1 className="font-display text-[2.75rem] font-black leading-[1.05] tracking-tight text-espresso sm:text-6xl lg:text-7xl">
              רוצים סוכן AI?
              <br />
              <span className="text-terra">אנחנו נסדר.</span>
            </h1>

            <p className="mt-6 max-w-lg text-xl font-light leading-relaxed text-espresso-light sm:text-2xl lg:text-start">
              ראיתם את כל הסרטונים על בוטים חכמים בוואטסאפ ונשמע לכם מסובך?
              אנחנו מקימים לכם סוכן AI אישי — על שרת פרטי, מוכן לשימוש, בלי לגעת בקוד.
            </p>

            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row lg:justify-start">
              <a
                href="#signup"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-terra px-8 py-4 text-lg font-bold text-white shadow-lg shadow-terra/25 transition-all hover:bg-espresso hover:shadow-xl hover:shadow-espresso/20 sm:w-auto"
              >
                <WhatsAppIcon className="h-5 w-5" />
                אני רוצה סוכן
              </a>
              <a
                href="#how-it-works"
                className="group inline-flex items-center gap-2 text-base font-semibold text-espresso-light transition hover:text-terra"
              >
                איך זה עובד?
                <svg className="h-4 w-4 transition-transform group-hover:translate-y-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </a>
            </div>

            {/* Trust signals */}
            <div className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-espresso-light lg:justify-start">
              <span className="flex items-center gap-1.5">
                <svg className="h-4 w-4 text-sage" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                הקמה תוך דקות
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="h-4 w-4 text-sage" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                מאובטח ופרטי
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="h-4 w-4 text-sage" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                בלי להתקין כלום
              </span>
            </div>
          </div>

          {/* Phone mockup */}
          <div className="animate-fade-up flex justify-center lg:justify-start" style={{ animationDelay: "0.2s" }}>
            <InteractiveChat />
          </div>
        </div>
      </div>
    </section>
  );
}
