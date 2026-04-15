export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="relative overflow-hidden bg-espresso px-5 py-16 sm:px-8 sm:py-20"
    >
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
            איך זה עובד
          </h2>
          <p className="mx-auto mt-4 max-w-md text-lg font-light text-white/50">
            מאפס לעוזר אישי משלכם. תוך דקות.
          </p>
        </div>

        <div className="mx-auto mt-14 grid max-w-5xl gap-16 sm:grid-cols-3 sm:gap-12">
          {/* Step 01 */}
          <div className="text-center" dir="rtl">
            <span className="text-7xl font-black leading-none text-terra/80">01</span>
            <h3 className="mt-5 text-xl font-bold text-white">
              נרשמים ומספרים מה חשוב
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-white/50">
              בוחרים פלטפורמה ומספרים מה הכי חשוב — יומן, תקציב, תזכורות, או הכל ביחד.
            </p>
            {/* Preview: interest chips */}
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {["📅 יומן", "💰 תקציב", "⏰ תזכורות", "🔍 מחקר", "🤖 הכל!"].map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs text-white/60"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Step 02 */}
          <div className="text-center" dir="rtl">
            <span className="text-7xl font-black leading-none text-terra/80">02</span>
            <h3 className="mt-5 text-xl font-bold text-white">
              אנחנו מקימים לכם סוכן
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-white/50">
              מפעילים סוכן AI פרטי על שרת מאובטח. אתם לא צריכים לעשות כלום.
            </p>
            {/* Preview: status checklist */}
            <div className="mt-6 space-y-2.5 text-start">
              {[
                { label: "שרת פרטי מוקצה", done: true },
                { label: "הצפנת AES-256 פעילה", done: true },
                { label: "סוכן מותאם אישית", done: true },
                { label: "חיבור וואטסאפ", done: false },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2.5">
                  <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                    item.done ? "bg-terra/20 text-terra" : "border border-white/10 text-white/20"
                  }`}>
                    {item.done ? "✓" : ""}
                  </div>
                  <span className={`text-xs ${item.done ? "text-white/60" : "text-white/30"}`}>
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Step 03 */}
          <div className="text-center" dir="rtl">
            <span className="text-7xl font-black leading-none text-terra/80">03</span>
            <h3 className="mt-5 text-xl font-bold text-white">
              שולחים הודעה ומתחילים
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-white/50">
              סורקים QR, שומרים באנשי קשר — וזהו. שולחים הודעה כמו לחבר.
            </p>
            {/* Preview: mini chat */}
            <div className="mt-6 space-y-2">
              <div className="mr-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-[#DCF8C6] px-3.5 py-2 text-start text-xs leading-relaxed text-black/80">
                היי, אני רוצה שתנהל לי את היומן
              </div>
              <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-bl-sm bg-white/10 px-3.5 py-2 text-start text-xs leading-relaxed text-white/70">
                בוקר טוב! 🙌 ספר לי איך היומן שלך נראה ואני מתחיל לסדר.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
