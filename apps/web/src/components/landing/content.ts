import { faqs } from "@/content/faq.he";
import { CANCEL_ANYTIME } from "@/content/plans.he";
import { SAFETY_FAQ } from "@/content/safety.he";
import { CATALOG_SIZE_LABEL } from "@/lib/integrations/catalog.he";
import { formatCredits } from "@/lib/billing/format";
import { PLANS, TRIAL_CREDITS, TRIAL_DAYS } from "@/lib/billing/pricing";

export const AGENT_NAME = "יובל";

export const CTA_LABEL = "יצירת סוכן";

export const TRIAL_NOTE = `${TRIAL_DAYS} ימים בחינם, בלי כרטיס אשראי`;

export const WHATSAPP_ASK = "יש שאלה? דברו איתנו בוואטסאפ";

export const TRIAL_DETAIL = `מתחילים ב-${TRIAL_DAYS} ימי ניסיון עם ${formatCredits(TRIAL_CREDITS)} קרדיטים, בלי כרטיס אשראי.`;

export const TRIAL_END = "כשהניסיון נגמר בוחרים תוכנית והסוכן ממשיך בלי הפסקה, עם כל ההגדרות והחיבורים שלו.";

export const PRICE_FROM = `אחר כך מ-${PLANS.basic.priceIls} ש״ח לחודש, ${CANCEL_ANYTIME}`;

export const APPS_MORE = `מעל ${CATALOG_SIZE_LABEL} אפליקציות נוספות`;

export const APP_ACTIONS = [
  { slug: "googlecalendar", action: "קובע פגישות, מזיז אותן ובודק מה יש לכם היום." },
  { slug: "gmail", action: "מחפש מיילים, מסכם אותם ושולח תשובות בשמכם." },
  { slug: "googlesheets", action: "מוסיף שורות, מעדכן נתונים ומכין טבלאות." },
  { slug: "googledrive", action: "מוצא קבצים ושומר בו מסמכים חדשים." },
  { slug: "outlook", action: "קורא ושולח מיילים וקובע פגישות ביומן של העבודה." },
  { slug: "monday", action: "פותח משימות בלוח ומעדכן את הסטטוס שלהן." },
  { slug: "notion", action: "יוצר דפים ומוסיף שורות לטבלאות." },
  { slug: "wix", action: "מנהל ומעדכן את האתר והבלוג שלכם." },
] as const;

const SECTION_LINKS = {
  day: { label: "מה הוא עושה", href: "#day" },
  business: { label: "לעסקים", href: "#business" },
  setup: { label: "איך מתחילים", href: "#setup" },
  pricing: { label: "מחירים", href: "#pricing" },
  faq: { label: "שאלות", href: "#faq" },
} as const;

export const NAV_LINKS = [SECTION_LINKS.day, SECTION_LINKS.business, SECTION_LINKS.setup, SECTION_LINKS.pricing, SECTION_LINKS.faq];

export const HEADER_LINKS = [SECTION_LINKS.business, SECTION_LINKS.pricing, SECTION_LINKS.faq];

interface Moment {
  time: string;
  label: string;
  user?: string;
  agent: string;
}

export const DAY_MOMENTS: readonly Moment[] = [
  {
    time: "07:45",
    label: "הוא כתב ראשון",
    agent: "בוקר טוב. היום יש לך פגישה עם רואה החשבון ב-10:00, ובערב אסיפת הורים ב-19:30. להזכיר לך חצי שעה לפני כל אחת?",
  },
  {
    time: "11:30",
    label: "קופת חולים",
    user: "תזכיר לי בעוד שבועיים לקבוע תור לרופא המשפחה",
    agent: "נקבע. ב-15/10 בבוקר אזכיר לך לקבוע תור לרופא המשפחה.",
  },
  {
    time: "13:10",
    label: "מייל",
    user: "יש משהו דחוף במייל?",
    agent: "שני מיילים מחכים לתשובה: הצעת מחיר מהספק ואישור מהבנק. ניסחתי תשובה לספק, לשלוח?",
  },
  {
    time: "21:00",
    label: "הוא כתב ראשון",
    agent: "מחר יום ההולדת של אמא. להזכיר לך בבוקר להתקשר אליה?",
  },
];

export const MORE_CAPABILITIES: readonly string[] = [
  "רשימת קניות לשבת לפי מה שחסר",
  "ניהול תקציב והוצאות בשקלים",
  "משימות קבועות שחוזרות כל יום",
  "ניסוח הודעות בעברית רהוטה",
];

export const DATA_FACTS = [
  "הסוכן ניגש למידע באפליקציות שחיברתם רק כדי לבצע את מה שביקשתם ממנו.",
  "אנחנו לא מוכרים את המידע שלכם. אף פעם.",
  "כל סוכן רץ בסביבה פרטית ומבודדת באירופה. המידע מוצפן במנוחה ובמעבר.",
  "אפשר לנתק כל אפליקציה בכל רגע מהאזור האישי, ולמחוק את החשבון מההגדרות.",
] as const;

export const LANDING_FAQS = [...faqs, SAFETY_FAQ];

export const FAQ_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: LANDING_FAQS.map((faq) => ({
    "@type": "Question",
    name: faq.q,
    acceptedAnswer: { "@type": "Answer", text: faq.a },
  })),
};
