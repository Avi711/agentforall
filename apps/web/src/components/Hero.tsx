import { ChatMockup } from "./ChatMockup";

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
            <h1 className="text-[2.75rem] font-black leading-[1.1] tracking-tight text-espresso sm:text-6xl lg:text-7xl">
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
                className="animate-pulse-soft inline-flex w-full items-center justify-center gap-2 rounded-full bg-terra px-8 py-4 text-lg font-bold text-white transition-all hover:bg-espresso hover:shadow-xl sm:w-auto"
              >
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                  <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
                </svg>
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
            <ChatMockup />
          </div>
        </div>
      </div>
    </section>
  );
}
