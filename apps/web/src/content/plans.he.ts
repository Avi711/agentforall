import { REFUND_WINDOW_DAYS, type PlanTier } from "@/lib/billing/pricing";
import { CATALOG_SIZE_LABEL } from "@/lib/integrations/catalog.he";

export interface PlanCopy {
  tagline: string;
  highlights: readonly string[];
}

export const PLAN_COPY: Record<PlanTier, PlanCopy> = {
  basic: {
    tagline: "לשימוש אישי יומיומי",
    highlights: ["סוכן אישי בוואטסאפ או בטלגרם", `חיבור ליותר מ־${CATALOG_SIZE_LABEL} אפליקציות`, "עובד 24/7"],
  },
  standard: {
    tagline: "לעסק קטן שעונה ללקוחות",
    highlights: ["כל מה שבבסיסי", "מקום למשימות אוטומטיות קבועות", "מתאים לשיחות לקוחות יומיות"],
  },
  pro: {
    tagline: "לעומס גבוה ואוטומציות",
    highlights: ["כל מה שבסטנדרט", "לסוכן שעובד על משימות ארוכות", "וואטסאפ לעסקים (בקרוב)"],
  },
};

export const BUSINESS_OFFER = {
  title: "לעסקים",
  note: "מחיר לפי הצורך",
  points: ["קרדיטים לפי ההיקף שלכם", "הטמעה וליווי אישי", "חיבור למערכות שכבר עובדות אצלכם"],
  cta: "דברו איתנו",
  whatsappText: "היי, אני מתעניין בתוכנית לעסקים",
} as const;

export const CREDITS_EXPLAINER =
  "כל פעולה של הסוכן עולה קרדיטים לפי כמה עבודה היא דורשת: תשובה קצרה עולה מעט, משימה ארוכה או אוטומטית עולה יותר. כאן תראו כמה נשאר ובאיזה קצב אתם צורכים. קרדיטים שטוענים בנוסף למנוי לא פגים.";

export const PLAN_TRUST_POINTS: readonly string[] = [
  "ביטול בכל עת",
  `החזר מלא תוך ${REFUND_WINDOW_DAYS} יום אם לא נוצלו קרדיטים`,
  "טעינת קרדיטים בכל עת, והם לא פגים",
];
