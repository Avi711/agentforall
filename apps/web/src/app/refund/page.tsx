import type { Metadata } from "next";
import { LegalPage, WhatsAppLink } from "@/components/LegalPage";
import { OperatorLine } from "@/components/OperatorLine";
import { REFUND_WINDOW_DAYS } from "@/lib/billing/pricing";

export const metadata: Metadata = {
  title: "מדיניות החזרים — Agent For All",
  description: "ביטול מנוי והחזר כספי בשירות Agent For All.",
};

export default function RefundPage() {
  return (
    <LegalPage title="מדיניות החזרים" updated="ספטמבר 2026">
      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">1. החזר על רכישה שלא נוצלה</h2>
        <p>
          על מנוי או טעינת קרדיטים אפשר לקבל החזר מלא תוך {REFUND_WINDOW_DAYS} יום מיום התשלום, כל עוד לא נוצלו קרדיטים מאותו תשלום. עם ההחזר, הקרדיטים שנוספו באותו תשלום יורדו מהחשבון.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">2. ביטול מנוי</h2>
        <p>
          אפשר לבטל את המנוי בכל עת דרך האזור האישי. הביטול נכנס לתוקף בסוף תקופת החיוב הנוכחית, והסוכן ממשיך לעבוד עד אז. אין החזר על חלק התקופה שנותר.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">3. מעבר בין תוכניות</h2>
        <p>
          שדרוג נכנס לתוקף מיד: מחייבים את הכרטיס השמור על יתרת התקופה הנוכחית, והקרדיטים המתאימים נוספים מיד. הסכום המדויק מוצג לפני
          האישור. מעבר לתוכנית זולה יותר נכנס לתוקף בחידוש הבא, בלי חיוב ובלי החזר: התוכנית הנוכחית והקרדיטים שלה נשארים עד אז, ואפשר
          לבטל את המעבר עד החידוש. מעבר מתוכנית חודשית לשנתית מחויב מיד ומתחיל שנה חדשה, ותוכנית שנתית משנים דרכנו.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">4. קרדיטים</h2>
        <p>
          קרדיטים משמשים לתשלום על עבודת הסוכן ברגע שהוא עונה, ולכן קרדיטים שנוצלו אינם ניתנים להחזר. קרדיטים שכלולים במנוי פגים בסוף תקופת החיוב. קרדיטים שנקנו בטעינה נפרדת אינם פגים.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">5. איך מבקשים החזר</h2>
        <p>
          פנו אלינו בוואטסאפ <WhatsAppLink /> או במייל, וציינו את כתובת המייל של החשבון. ההחזר יוחזר לאמצעי התשלום המקורי. הזמן עד שהכסף מופיע בחשבון תלוי בחברת האשראי.
        </p>
        <p className="mt-3">
          התשלום מתבצע דרך ספק תשלומים חיצוני, ששמו מופיע בעמוד התשלום ובקבלה. כשהספק פועל כמשווק מורשה, הוא המוכר הרשמי ומבצע את ההחזר, ואפשר לפנות גם אליו ישירות.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold text-espresso">6. יצירת קשר</h2>
        <p>
          <OperatorLine />
        </p>
      </section>
    </LegalPage>
  );
}
