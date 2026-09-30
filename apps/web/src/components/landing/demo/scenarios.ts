import type { AppKey } from "../marks";

export interface AgentAction {
  app: AppKey;
  label: string;
}

export interface CalendarSlot {
  day: number;
  hour: number;
  label: string;
}

interface CalendarResult {
  kind: "calendar";
  title: string;
  who: string;
  from: CalendarSlot;
  to: CalendarSlot;
}

interface SheetResult {
  kind: "sheet";
  file: string;
  count: number;
  rows: ReadonlyArray<readonly [vendor: string, date: string, amount: string]>;
  total: string;
}

interface PriceResult {
  kind: "price";
  route: string;
  current: number;
  target: number;
  history: readonly number[];
}

export type ScenarioResult = CalendarResult | SheetResult | PriceResult;

export interface Scenario {
  id: string;
  tab: string;
  request: string;
  actions: readonly AgentAction[];
  reply: string;
  result: ScenarioResult;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "meeting",
    tab: "להזיז פגישה",
    request: "תזיז לי את הפגישה עם דני לחמישי ב-3 ותעדכן אותו",
    actions: [
      { app: "calendar", label: "מוצא ביומן את הפגישה עם דני" },
      { app: "calendar", label: "מזיז לחמישי, 15:00" },
      { app: "whatsapp", label: "שולח לדני עדכון" },
    ],
    reply: "הזזתי לחמישי ב-15:00 ועדכנתי את דני.",
    result: {
      kind: "calendar",
      title: "פגישה עם דני",
      who: "דני",
      from: { day: 2, hour: 10, label: "שלישי · 10:00" },
      to: { day: 4, hour: 15, label: "חמישי · 15:00" },
    },
  },
  {
    id: "invoices",
    tab: "אקסל לרו״ח",
    request: "תוציא מהמייל את החשבוניות של החודש ותכין אקסל לרו״ח",
    actions: [
      { app: "gmail", label: "סורק את המייל: 14 חשבוניות" },
      { app: "sheets", label: "בונה גיליון עם ספק, סכום ומע״מ" },
      { app: "gmail", label: "שולח לך את הקובץ" },
    ],
    reply: "מוכן: 14 חשבוניות, סה״כ 8,340 ש״ח. הקובץ גם אצלך במייל.",
    result: {
      kind: "sheet",
      file: "חשבוניות.xlsx",
      count: 14,
      rows: [
        ["בזק", "03/09", "189 ₪"],
        ["פז", "07/09", "412 ₪"],
        ["אלקטרה", "12/09", "1,260 ₪"],
      ],
      total: "8,340 ₪",
    },
  },
  {
    id: "flight",
    tab: "לעקוב אחרי טיסה",
    request: "תעקוב אחרי הטיסה לברלין ב-28/4 ותגיד לי אם יורדת מ-1,200",
    actions: [
      { app: "flights", label: "בודק מחירים באל-על ובארקיע" },
      { app: "flights", label: "קובע בדיקה פעמיים ביום" },
    ],
    reply: "במעקב. כרגע 1,450 ש״ח, אכתוב לך ברגע שיירד מ-1,200.",
    result: {
      kind: "price",
      route: "תל אביב ← ברלין · 28/4",
      current: 1450,
      target: 1200,
      history: [1590, 1540, 1610, 1520, 1480, 1500, 1450],
    },
  },
];
