import type { Metadata } from "next";
import { LegalPage, WhatsAppLink } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "הצהרת נגישות — Agent For All",
  description: "הצהרת הנגישות של Agent For All — התחייבותנו להנגשת השירות לכלל המשתמשים.",
};

export default function AccessibilityPage() {
  return (
    <LegalPage title="הצהרת נגישות" updated="אפריל 2026">
      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">התחייבות לנגישות</h2>
        <p>
          Agent For All (״האתר״) פועלת להנגשת שירותיה לכלל הציבור, לרבות אנשים עם מוגבלות, בהתאם לתקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע״ג-2013 ובהתאם לתקן הישראלי ת״י 5568 ברמה AA.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">אמצעי הנגישות באתר</h2>
        <ul className="list-inside list-disc space-y-2 ps-2">
          <li>תאימות ברמת AA של תקן WCAG 2.1</li>
          <li>מבנה סמנטי של כותרות ופסקאות לתמיכה בקוראי מסך</li>
          <li>ניגודיות צבעים מוגברת בין טקסט לרקע</li>
          <li>ניווט מלא באמצעות מקלדת</li>
          <li>טקסט חלופי לתמונות ואייקונים</li>
          <li>תמיכה בהגדלת טקסט בדפדפן</li>
          <li>כיבוד העדפת המערכת להפחתת תנועה (prefers-reduced-motion)</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">סייגים</h2>
        <p>
          ייתכן ובחלקים מהאתר טרם הושלמה התאמת הנגישות המלאה. אנו פועלים באופן שוטף לשיפור הנגישות ולתיקון ליקויים.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">יצירת קשר בנושא נגישות</h2>
        <p>
          נתקלתם בבעיית נגישות? נשמח לסייע. צרו איתנו קשר בוואטסאפ:
        </p>
        <p className="mt-3">
          <WhatsAppLink />
        </p>
        <p className="mt-3">
          נענה לפנייתכם בתוך 5 ימי עסקים.
        </p>
      </section>
    </LegalPage>
  );
}
