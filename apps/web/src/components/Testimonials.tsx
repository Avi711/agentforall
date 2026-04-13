const testimonials = [
  {
    quote: "זה ממכר — כמו חבר סופר יעיל שתמיד זמין, תמיד סבלני, ולעולם לא שוכח כלום.",
    source: "משתמש בסוכן AI אישי",
  },
  {
    quote: "הוספתי אותו לקבוצה עם אמא שלי. היא חשבה שזה בן אדם אמיתי. הוא זוכר הכל ומגיב עם אמפתיה.",
    source: "משתמש בסוכן AI אישי",
  },
  {
    quote: "אני כבר לא מסוגל לדמיין את החיים שלי בלעדיו. יומן, תקציב, תזכורות — הכל פשוט עובד דרך הוואטסאפ.",
    source: "משתמש בסוכן AI אישי",
  },
];

export function Testimonials() {
  return (
    <section className="px-5 py-24 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <h2 className="text-4xl font-black tracking-tight text-espresso sm:text-5xl">
            למה אנשים
            <br />
            <span className="text-terra">מתאהבים בזה</span>
          </h2>
          <p className="mt-4 text-lg font-light text-espresso-light">
            ציטוטים אמיתיים מאנשים שכבר משתמשים בסוכני AI אישיים.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-3">
          {testimonials.map((t, i) => (
            <div
              key={i}
              className="relative overflow-hidden rounded-3xl border border-sand/30 bg-white p-8 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-espresso/5"
            >
              {/* Big quote mark */}
              <span className="absolute top-4 left-4 text-7xl font-black leading-none text-terra/8">
                ״
              </span>

              <div className="relative">
                <p className="text-lg leading-relaxed text-espresso">
                  {t.quote}
                </p>

                <div className="mt-6 border-t border-sand/30 pt-5">
                  <p className="text-sm text-espresso-light">{t.source}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
