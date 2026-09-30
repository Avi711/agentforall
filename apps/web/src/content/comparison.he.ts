import { PLANS } from "@/lib/billing/pricing";

interface ComparisonRow {
  label: string;
  agent: string;
  chat: string;
  agentWins: boolean;
  agentNote?: boolean;
}

export const COMPARISON = {
  eyebrow: "למה לא פשוט צ׳אט AI?",
  titleLead: "צ׳אט עונה.",
  titleAccent: "סוכן עושה.",
  agentColumn: "הסוכן שלכם",
  chatColumn: "צ׳אט AI",
  note: "* המחיר כולל סביבה פרטית מאובטחת, הקמה מלאה וקרדיטים לחודש.",
} as const;

export const COMPARISON_ROWS: readonly ComparisonRow[] = [
  { label: "איפה הוא נמצא", agent: "בוואטסאפ או בטלגרם שלכם", chat: "באפליקציה או באתר נפרדים", agentWins: true },
  { label: "מי פותח את השיחה", agent: "גם הוא: מזכיר, מעדכן ועוקב", chat: "בדרך כלל אתם", agentWins: true },
  { label: "כשאתם ישנים", agent: "ממשיך לעבוד, ויכול לענות ללקוחות שלכם", chat: "לא עונה ללקוחות שלכם", agentWins: true },
  { label: "פעולות בשמכם", agent: "ביומן, במייל ובאפליקציות שחיברתם", chat: "בעיקר בתוך הצ׳אט עצמו", agentWins: true },
  { label: "איפה הוא רץ", agent: "בסביבה פרטית ומבודדת משלכם", chat: "בשירות משותף", agentWins: true },
  { label: "מחיר לחודש", agent: `מ-${PLANS.basic.priceIls} ש״ח`, chat: "חינם, או כ-20 דולר למנוי", agentWins: false, agentNote: true },
];
