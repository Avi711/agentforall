import type { Metadata } from "next";
import { LegalPage, WhatsAppLink } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "תנאי שימוש — Agent For All",
  description: "תנאי השימוש בשירות Agent For All.",
};

export default function TermsPage() {
  return (
    <LegalPage title="תנאי שימוש" updated="אפריל 2026">
      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">1. כללי</h2>
        <p>
          ברוכים הבאים ל-Agent For All (״השירות״, ״אנחנו״). השימוש באתר ובשירות כפוף לתנאים המפורטים להלן. עצם הרישום או השימוש מהווה הסכמה מלאה לתנאים אלה. אם אינכם מסכימים לתנאים — אנא אל תשתמשו בשירות.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">2. השירות</h2>
        <p>
          Agent For All מספקת שירות סוכן בינה מלאכותית אישי הפועל בתוך אפליקציות מסרים (וואטסאפ, טלגרם). הסוכן פועל בשמכם לביצוע משימות כגון ניהול יומן, תזכורות, חיפוש מידע ואוטומציות.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">3. אחריות המשתמש</h2>
        <ul className="list-inside list-disc space-y-2 ps-2">
          <li>אתם אחראים להגדרת גבולות הסוכן ולהרשאות שאתם מעניקים לו.</li>
          <li>אל תשתפו עם הסוכן מידע רגיש שאינכם מוכנים שייחשף (סיסמאות, מידע רפואי מסווג, פרטי אשראי).</li>
          <li>השימוש בסוכן לפעילות לא חוקית, הטרדה, או פגיעה בצד שלישי — אסור.</li>
          <li>אתם אחראים על פעולות הסוכן בשמכם, כולל הודעות שנשלחות ותוכן שנוצר.</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">4. מגבלות אחריות</h2>
        <p>
          השירות מסופק ״כפי שהוא״ (AS IS). אנו עושים את המקסימום לאבטחה ולאיכות, אך איננו אחראים לנזקים עקיפים, אובדן מידע, החלטות שהתקבלו על בסיס המלצות הסוכן, או הפרעות בשירות.
        </p>
        <p className="mt-3">
          הסוכן מבוסס על מודלי AI של צד שלישי (Anthropic Claude ואחרים). איננו אחראים לתוכן שנוצר על-ידי מודלים אלה, והוא עשוי לכלול טעויות.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">5. תשלום וביטול</h2>
        <p>
          המנוי החודשי מתחיל מ-199 ש״ח לחודש (כולל מע״מ). המחיר הסופי תלוי בהיקף השימוש ובמשאבים הנצרכים. ניתן לבטל את המנוי בכל עת דרך האזור האישי; הביטול ייכנס לתוקף בסוף החודש הנוכחי, ללא החזר על חלק החודש שחלף.
        </p>
        <p className="mt-3">
          בהתאם לחוק הגנת הצרכן, תשנ״א-1981, ניתן לבטל את העסקה תוך 14 יום מיום הרישום.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">6. קניין רוחני</h2>
        <p>
          כל הזכויות בשירות, בקוד, בעיצוב, ובתכנים שמורות ל-Agent For All. אין להעתיק, להפיץ, או לעשות שימוש מסחרי בכל חלק מהשירות ללא אישור מראש ובכתב.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">7. סמכות שיפוט</h2>
        <p>
          על תנאים אלה יחול הדין הישראלי בלבד. סמכות השיפוט הייחודית בכל סכסוך שיתגלע — נתונה לבתי המשפט המוסמכים במחוז תל אביב.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">8. שינויים בתנאים</h2>
        <p>
          אנו רשאים לעדכן את התנאים מעת לעת. שינויים מהותיים יפורסמו באתר ו/או יישלחו באימייל. המשך שימוש לאחר עדכון מהווה הסכמה לתנאים המעודכנים.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">9. יצירת קשר</h2>
        <p>
          שאלות? פנו אלינו בוואטסאפ: <WhatsAppLink />.
        </p>
      </section>
    </LegalPage>
  );
}
