import { Reveal } from "./Reveal";

const testimonials = [
  "זה ממכר — כמו חבר סופר יעיל שתמיד זמין, תמיד סבלני, ולעולם לא שוכח כלום.",
  "הוספתי אותו לקבוצה עם אמא שלי. היא חשבה שזה בן אדם אמיתי. הוא זוכר הכל ומגיב עם אמפתיה.",
  "אני כבר לא מסוגל לדמיין את החיים שלי בלעדיו. יומן, תקציב, תזכורות — הכל פשוט עובד דרך הוואטסאפ.",
];

export function Testimonials() {
  return (
    <section className="px-5 py-24 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <h2 className="font-display text-4xl font-black leading-[1.1] tracking-tight text-espresso sm:text-5xl">
            למה אנשים
            <br />
            <span className="text-terra">מתאהבים בזה</span>
          </h2>
          <p className="mt-4 text-lg font-light text-espresso-light">
            ציטוטים אמיתיים מאנשים שכבר משתמשים בסוכני AI אישיים.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-3">
          {testimonials.map((quote, i) => (
            <Reveal
              key={i}
              delay={i * 120}
              className="relative flex flex-col overflow-hidden rounded-3xl border border-sand/30 bg-white p-8 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-espresso/5"
            >
              <span className="absolute top-4 left-4 text-7xl font-black leading-none text-terra/8">
                ״
              </span>

              <p className="relative flex-1 text-lg leading-relaxed text-espresso">
                {quote}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
