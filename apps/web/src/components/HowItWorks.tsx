const STEPS = [
  {
    title: "נכנסים עם Google ונותנים לסוכן שם",
    body: "בלי טפסים ובלי כרטיס אשראי. שם אחד, וזהו.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-6 w-6">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    ),
  },
  {
    title: "תוך דקה הוא רץ על שרת פרטי משלכם",
    body: "אנחנו מקימים אותו. אתם לא מתקינים כלום.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-6 w-6">
        <rect x="3" y="4" width="18" height="7" rx="2" />
        <rect x="3" y="13" width="18" height="7" rx="2" />
        <path d="M7 7.5h.01M7 16.5h.01" />
      </svg>
    ),
  },
  {
    title: "מחברים טלגרם או וואטסאפ ושולחים הודעה",
    body: "בטלגרם זה שתי לחיצות, בוואטסאפ סורקים קוד. ומכאן כותבים לו כמו לחבר.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-6 w-6">
        <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.4A8 8 0 1 1 20 12z" />
      </svg>
    ),
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="py-16 sm:py-24">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <header className="text-center mb-10 sm:mb-14">
          <p className="text-xs uppercase tracking-[0.22em] text-espresso-light/80 mb-3">איך זה עובד</p>
          <h2 id="how-it-works-title" className="font-display text-3xl sm:text-4xl text-espresso leading-tight">
            מאפס לעוזר אישי משלכם, תוך דקות
          </h2>
        </header>

        <ol className="grid gap-4 sm:gap-6 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex flex-col gap-4 rounded-[24px] border border-sand-light bg-white p-6 sm:p-8">
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sage-pale text-sage-dark">{step.icon}</span>
                <span className="text-xs uppercase tracking-[0.18em] text-espresso-light/70">שלב {i + 1}</span>
              </div>
              <h3 className="font-display text-xl text-espresso leading-snug">{step.title}</h3>
              <p className="text-sm leading-relaxed text-espresso-light">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
