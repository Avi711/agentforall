export function Disclaimer() {
  return (
    <section className="px-5 py-2 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-2xl bg-espresso px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex gap-4">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-terra text-xl">
              ⚠️
            </div>
            <div>
              <h3 className="text-lg font-black text-cream">
                חשוב לדעת לפני שמתחילים
              </h3>
              <ul className="mt-3 space-y-2 text-[15px] leading-relaxed text-sand-light">
                <li className="flex gap-2">
                  <span className="mt-1 shrink-0 text-terra">•</span>
                  <span>סוכן AI אישי הוא כלי עוצמתי עם גישה רחבה — הוא יכול לפעול בשמכם, לשלוח הודעות, לחפש מידע ולבצע פעולות. הגדירו לו גבולות ברורים.</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-1 shrink-0 text-terra">•</span>
                  <span>הסוכן רץ על שרת מבודד ומאובטח, אבל שום מערכת לא חסינה לחלוטין. אל תשתפו מידע שאתם לא מוכנים שייחשף.</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-1 shrink-0 text-terra">•</span>
                  <span>התחילו עם הרשאות מצומצמות והרחיבו בהדרגה. דרשו אישור ידני לפעולות בלתי הפיכות כמו שליחת הודעות או מחיקת קבצים.</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-1 shrink-0 text-terra">•</span>
                  <span>אנחנו עושים את המקסימום כדי לאבטח את השירות — אבל השימוש הוא באחריותכם.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
