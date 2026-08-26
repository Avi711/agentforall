export interface FeaturedApp {
  slug: string;
  nameHe: string;
  blurbHe: string;
}

// Shown first, in this order, with Hebrew copy; the rest of the catalog stays searchable in English.
export const FEATURED_APPS: readonly FeaturedApp[] = [
  { slug: "gmail", nameHe: "Gmail", blurbHe: "קריאה, חיפוש ושליחה של מיילים" },
  { slug: "googlecalendar", nameHe: "יומן Google", blurbHe: "פגישות, תזכורות וזמינות" },
  { slug: "googledrive", nameHe: "Google Drive", blurbHe: "חיפוש וקריאה של קבצים" },
  { slug: "googlesheets", nameHe: "Google Sheets", blurbHe: "קריאה ועדכון של גיליונות" },
  { slug: "googledocs", nameHe: "Google Docs", blurbHe: "יצירה ועריכה של מסמכים" },
  { slug: "googletasks", nameHe: "Google Tasks", blurbHe: "משימות ורשימות" },
  { slug: "outlook", nameHe: "Outlook", blurbHe: "מייל ויומן של Microsoft" },
  { slug: "notion", nameHe: "Notion", blurbHe: "דפים, מסדי נתונים ורשימות" },
  { slug: "slack", nameHe: "Slack", blurbHe: "הודעות וערוצים" },
  { slug: "trello", nameHe: "Trello", blurbHe: "לוחות וכרטיסים" },
  { slug: "asana", nameHe: "Asana", blurbHe: "משימות ופרויקטים" },
  { slug: "monday", nameHe: "monday.com", blurbHe: "לוחות עבודה ופריטים" },
  { slug: "hubspot", nameHe: "HubSpot", blurbHe: "לקוחות, עסקאות ומעקב" },
  { slug: "github", nameHe: "GitHub", blurbHe: "ריפוזיטוריז, issues ו-PRs" },
  { slug: "linear", nameHe: "Linear", blurbHe: "משימות פיתוח" },
  { slug: "dropbox", nameHe: "Dropbox", blurbHe: "קבצים ותיקיות" },
  { slug: "todoist", nameHe: "Todoist", blurbHe: "משימות יומיות" },
  { slug: "canva", nameHe: "Canva", blurbHe: "עיצובים ותבניות" },
];

const BY_SLUG = new Map(FEATURED_APPS.map((app) => [app.slug, app]));

export function featuredApp(slug: string): FeaturedApp | undefined {
  return BY_SLUG.get(slug);
}
