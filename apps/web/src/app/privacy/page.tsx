import type { Metadata } from "next";
import { LegalPage, WhatsAppLink } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "מדיניות פרטיות — Agent For All",
  description: "מדיניות הפרטיות של Agent For All — איך אנחנו אוספים, שומרים ומגינים על המידע שלכם.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="מדיניות פרטיות" updated="אפריל 2026">
      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">1. איזה מידע אנחנו אוספים</h2>
        <p>בעת ההרשמה והשימוש בשירות אנחנו אוספים:</p>
        <ul className="mt-3 list-inside list-disc space-y-2 ps-2">
          <li><strong className="text-espresso">פרטי הרשמה:</strong> שם, אימייל, מספר טלפון (אופציונלי), תחומי עניין.</li>
          <li><strong className="text-espresso">מידע תפעולי:</strong> הודעות שאתם מחליפים עם הסוכן — לצורך מתן השירות בלבד.</li>
          <li><strong className="text-espresso">מידע טכני:</strong> כתובת IP, סוג דפדפן, זמני גישה — למטרות אבטחה ואנליטיקה.</li>
          <li><strong className="text-espresso">Meta Pixel + Google Analytics:</strong> לצורך מדידת ביצועי אתר ופרסום.</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">2. איך אנחנו שומרים את המידע</h2>
        <ul className="list-inside list-disc space-y-2 ps-2">
          <li>כל סוכן רץ על שרת פרטי ומבודד (Isolated container).</li>
          <li>המידע מוצפן במנוחה (AES-256) ובמעבר (TLS 1.3).</li>
          <li>גישה פנימית מוגבלת לעובדים מורשים בלבד, תחת הסכמי סודיות.</li>
          <li>השרתים נמצאים במרכזי נתונים תקניים (AWS / GCP) באזור אירופה או ישראל.</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">3. שימושים במידע</h2>
        <p>אנחנו משתמשים במידע שלכם אך ורק למטרות הבאות:</p>
        <ul className="mt-3 list-inside list-disc space-y-2 ps-2">
          <li>מתן השירות — הפעלת הסוכן, ביצוע משימות שביקשתם.</li>
          <li>תמיכה ותקשורת איתכם.</li>
          <li>שיפור השירות ומדידת ביצועים.</li>
          <li>עמידה בדרישות חוק.</li>
        </ul>
        <p className="mt-3">
          <strong className="text-espresso">אנחנו לא מוכרים את המידע שלכם.</strong> אף פעם.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">4. שיתוף מידע עם צדדים שלישיים</h2>
        <p>אנו משתפים מידע רק עם ספקי שירות הכרחיים להפעלת המערכת:</p>
        <ul className="mt-3 list-inside list-disc space-y-2 ps-2">
          <li><strong className="text-espresso">Anthropic (Claude):</strong> מודל ה-AI שמפעיל את הסוכן. הודעות מועברות לצורך יצירת תגובה.</li>
          <li><strong className="text-espresso">Meta (WhatsApp):</strong> תשתית המסרים.</li>
          <li><strong className="text-espresso">Vercel / AWS:</strong> תשתית אירוח.</li>
          <li><strong className="text-espresso">רשויות חוק:</strong> רק בהתאם לצו שיפוטי תקף.</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">5. זכויותיכם (חוק הגנת הפרטיות)</h2>
        <p>על פי חוק הגנת הפרטיות, התשמ״א-1981, מגיע לכם:</p>
        <ul className="mt-3 list-inside list-disc space-y-2 ps-2">
          <li><strong className="text-espresso">זכות עיון:</strong> לדעת איזה מידע יש עליכם.</li>
          <li><strong className="text-espresso">זכות תיקון:</strong> לעדכן מידע לא מדויק.</li>
          <li><strong className="text-espresso">זכות מחיקה:</strong> לבקש מחיקת מידע אישי (כפוף להוראות חוק).</li>
          <li><strong className="text-espresso">זכות ניידות:</strong> לקבל עותק של המידע שלכם.</li>
        </ul>
        <p className="mt-3">
          לממש זכות — פנו אלינו בוואטסאפ: <WhatsAppLink />. נענה בתוך 30 יום.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">6. Cookies</h2>
        <p>
          האתר משתמש ב-cookies לצורך תפעול, מדידה ופרסום (Meta Pixel). אתם יכולים לחסום cookies בהגדרות הדפדפן, אך חלק מהפונקציונליות עשוי להיפגע.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">7. שמירת מידע</h2>
        <p>
          אנו שומרים את המידע כל עוד החשבון פעיל, או ככל הנדרש לצורך מתן השירות ועמידה בחובותינו על פי חוק. לאחר סגירת החשבון — המידע נמחק תוך 90 יום, למעט מידע שאנו מחויבים לשמור בחוק (לדוגמה, חשבוניות — 7 שנים).
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">8. קטינים</h2>
        <p>
          השירות מיועד לבני 18 ומעלה. אם אתם מתחת לגיל 18, אנא אל תשתמשו בשירות ללא אישור הורה/אפוטרופוס.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">9. יצירת קשר</h2>
        <p>
          שאלות או בקשות בנושא פרטיות? פנו אלינו בוואטסאפ: <WhatsAppLink />.
        </p>
      </section>
    </LegalPage>
  );
}
