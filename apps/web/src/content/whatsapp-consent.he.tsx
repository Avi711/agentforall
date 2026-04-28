import Link from "next/link";

export function WhatsappConsentBody() {
  return (
    <div className="space-y-4 text-espresso-light leading-relaxed">
      <p>
        חיבור חשבון WhatsApp שלכם לסוכן AI מתבצע דרך WhatsApp Web (Baileys) —
        אותה טכנולוגיה שבה משתמשים כל שירותי הבוטים לא-רשמיים בישראל ובעולם.
      </p>
      <p className="font-semibold text-espresso">
        מה שחשוב שתדעו לפני שתמשיכו:
      </p>
      <ul className="space-y-2 list-disc ps-5 marker:text-terra">
        <li>
          <strong>Meta אוסרת במפורש</strong> בוטים כלליים של AI ב-WhatsApp מאז
          15 בינואר 2026 — גם דרך ה-API הרשמי שלהם.
        </li>
        <li>
          יש סיכון אמיתי של השעיית חשבון, במיוחד עבור מספרים חדשים או שימוש אינטנסיבי.
          התופעה מתועדת ברחבי העולם.
        </li>
        <li>
          אנחנו לא יכולים להבטיח שחשבון WhatsApp שלכם לא יושעה. זו אחריותכם.
        </li>
      </ul>
      <p className="font-semibold text-espresso pt-2">ההמלצה שלנו:</p>
      <ul className="space-y-2 list-disc ps-5 marker:text-sage">
        <li>
          <strong>השתמשו במספר נפרד</strong> — eSIM ייעודית או סים משני — ולא במספר
          הראשי שבו אתם משתמשים מול המשפחה, הלקוחות או הבנק.
        </li>
        <li>
          תנו לבוט להתנהג כמוכם — לא כמרכזיית לקוחות. תדרי הודעות סבירים, ללא
          broadcast להמונים.
        </li>
        <li>
          אם המספר יושעה בכל זאת — אפשר בקלות לחבר מספר חדש, כל המידע של הסוכן
          שלכם נשמר.
        </li>
      </ul>
      <p className="text-sm pt-3 border-t border-sand-light">
        פרטים מלאים מופיעים ב
        <Link href="/terms" className="text-terra underline mx-1">
          תנאי השימוש
        </Link>
        ובמדיניות ה
        <Link href="/privacy" className="text-terra underline mx-1">
          פרטיות
        </Link>
        שלנו. לחיצה על &quot;אני מסכים וממשיך&quot; מהווה אישור כי קראתם והבנתם.
      </p>
    </div>
  );
}
