const conversations = [
  {
    user: "תזיז לי את הפגישה עם דני למחר ב-3 ותשלח לו הודעה שזז",
    agent: "הזזתי ביומן ל-15:00 מחר. שלחתי לדני: ״היי, הפגישה עברה למחר ב-3, מקווה שמתאים.״ ✅ נשלח.",
  },
  {
    user: "כל בוקר ב-7:00 תשלח לי סיכום של מה מחכה לי היום",
    agent: "נקבע. כל בוקר ב-7:00 תקבלו בריף: פגישות, משימות פתוחות, מזג אוויר, ואם יש ימי הולדת לאנשי קשר. מתחיל מחר.",
  },
  {
    user: "תוריד את כל החשבוניות מהמייל של החודש האחרון ותכין לי אקסל",
    agent: "מצאתי 14 חשבוניות. הכנתי קובץ Excel עם תאריך, ספק, סכום ומע״מ. סה״כ: 8,340 ש״ח. שולח לך את הקובץ.",
  },
  {
    user: "תבנה לי דף נחיתה פשוט לאירוע שלי בשבוע הבא",
    agent: "בניתי דף עם הפרטים מההודעה שלך — תאריך, מיקום, טופס הרשמה. הוא רץ על https://event-xyz.vercel.app. רוצה שאשנה משהו?",
  },
  {
    user: "תשלח לכל הקבוצה הודעה שהמפגש בשישי עבר לפארק הירקון",
    agent: "שלחתי לקבוצה ״חברים שישי״: ״היי לכולם! המפגש בשישי עבר לפארק הירקון, אותה שעה. נתראה!״ ✅",
  },
  {
    user: "תעקוב אחרי המחיר של הטיסה לברלין ב-28/4 ותגיד לי אם יורד מתחת ל-200",
    agent: "מעקב פעיל. אבדוק את המחיר פעמיים ביום ואעדכן אתכם ברגע שיורד מ-200 ש״ח. כרגע עומד על 249.",
  },
];

const capabilities = [
  "שליחת הודעות ומיילים בשמכם",
  "ניהול יומן — הזזה, קביעה, ביטול",
  "אוטומציות יומיות קבועות",
  "הורדת קבצים ויצירת דוחות",
  "מעקב מחירים והתראות",
  "בניית אתרים ואפליקציות",
  "ניהול תקציב והוצאות",
  "חיפוש ובדיקת עובדות",
  "תסריטים ואינטגרציות",
  "ועוד... הגבול הוא הדמיון שלכם",
];

export function Features() {
  return (
    <section id="features" className="relative px-5 py-24 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <h2 className="text-4xl font-black tracking-tight text-espresso sm:text-5xl">
            כל מה שצריך,
            <br />
            <span className="text-terra">במרחק הודעה</span>
          </h2>
          <p className="mt-4 text-lg font-light text-espresso-light">
            הסוכן שלכם יכול לעשות כמעט כל דבר. הנה כמה דוגמאות מהחיים:
          </p>
        </div>

        {/* Conversation examples */}
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {conversations.map((conv, i) => (
            <div
              key={i}
              className="group overflow-hidden rounded-2xl border border-sand/40 bg-white transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-espresso/5"
            >
              <div className="space-y-2.5 px-5 py-5" dir="rtl" style={{ backgroundColor: "#f7f4ef" }}>
                <div className="flex justify-end">
                  <div className="max-w-[90%] rounded-2xl rounded-tl-sm bg-wa-light px-4 py-2.5 text-[14px] leading-relaxed text-espresso shadow-sm">
                    {conv.user}
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="max-w-[90%] rounded-2xl rounded-tr-sm bg-white px-4 py-2.5 text-[14px] leading-relaxed text-espresso shadow-sm">
                    {conv.agent}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Capability cloud */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-2.5">
          {capabilities.map((cap) => (
            <span
              key={cap}
              className="rounded-full border border-sand/50 bg-white px-4 py-2 text-sm text-espresso-light transition-colors hover:border-terra/30 hover:text-terra"
            >
              {cap}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
