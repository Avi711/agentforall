const steps = [
  {
    number: "01",
    title: "נרשמים ומספרים מה חשוב",
    description: "בוחרים פלטפורמה (וואטסאפ, טלגרם, או שניהם) ומספרים מה הכי חשוב — יומן, תקציב, תזכורות, או הכל ביחד.",
    visual: "📝",
  },
  {
    number: "02",
    title: "אנחנו מקימים לכם סוכן",
    description: "מפעילים סוכן AI פרטי רק בשבילכם — על תשתית מאובטחת, מותאם לחלוטין לנתונים ולצרכים שלכם.",
    visual: "🔒",
  },
  {
    number: "03",
    title: "סורקים QR ומתחילים לדבר",
    description: "סורקים QR קוד, שומרים את המספר באנשי הקשר — וזהו. שולחים הודעה כמו לחבר. הסוכן לומד ומשתפר עם הזמן.",
    visual: "💬",
  },
];

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="grain relative overflow-hidden bg-espresso px-5 py-24 sm:px-8"
    >
      {/* Decorative circle */}
      <div className="absolute top-[-200px] left-[-200px] h-[500px] w-[500px] rounded-full bg-terra/10 blur-3xl" />

      <div className="relative mx-auto max-w-6xl">
        <div className="text-center">
          <h2 className="text-4xl font-black tracking-tight text-cream sm:text-5xl">
            איך זה עובד
          </h2>
          <p className="mt-4 text-lg font-light text-sand-light">
            מאפס לעוזר אישי משלכם. תוך דקות.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.number}
              className="group relative rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm transition-all duration-300 hover:border-terra/30 hover:bg-white/10"
            >
              <div className="mb-6 flex items-center justify-between">
                <span className="text-5xl">{step.visual}</span>
                <span className="text-5xl font-black text-white/10 transition-colors group-hover:text-terra/30">
                  {step.number}
                </span>
              </div>
              <h3 className="text-xl font-bold text-cream">
                {step.title}
              </h3>
              <p className="mt-3 leading-relaxed text-sand-light">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
