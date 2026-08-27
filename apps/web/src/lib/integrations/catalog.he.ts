export interface FeaturedApp {
  slug: string;
  nameHe: string;
  blurbHe: string;
}

// Shown first, in this order, with Hebrew copy; the rest of the catalog stays searchable in English.
export const FEATURED_APPS: readonly FeaturedApp[] = [
  { slug: "gmail", nameHe: "Gmail", blurbHe: "לקרוא, לחפש ולשלוח מיילים" },
  { slug: "googlecalendar", nameHe: "יומן Google", blurbHe: "לקבוע פגישות ולבדוק מה יש היום" },
  { slug: "googledrive", nameHe: "Google Drive", blurbHe: "לחפש ולקרוא קבצים" },
  { slug: "googlesheets", nameHe: "Google Sheets", blurbHe: "לקרוא ולעדכן גיליונות" },
  { slug: "googledocs", nameHe: "Google Docs", blurbHe: "לכתוב ולערוך מסמכים" },
  { slug: "googletasks", nameHe: "Google Tasks", blurbHe: "לנהל משימות ורשימות" },
  { slug: "outlook", nameHe: "Outlook", blurbHe: "מייל ויומן של Microsoft" },
  { slug: "notion", nameHe: "Notion", blurbHe: "דפים, טבלאות ורשימות" },
  { slug: "slack", nameHe: "Slack", blurbHe: "לקרוא ולשלוח הודעות בערוצים" },
  { slug: "trello", nameHe: "Trello", blurbHe: "לוחות וכרטיסים" },
  { slug: "asana", nameHe: "Asana", blurbHe: "משימות ופרויקטים בצוות" },
  { slug: "monday", nameHe: "monday.com", blurbHe: "לוחות עבודה ופריטים" },
  { slug: "hubspot", nameHe: "HubSpot", blurbHe: "לקוחות, עסקאות ומעקב" },
  { slug: "github", nameHe: "GitHub", blurbHe: "ריפוזיטוריז, Issues ו־PRs" },
  { slug: "linear", nameHe: "Linear", blurbHe: "משימות פיתוח" },
  { slug: "dropbox", nameHe: "Dropbox", blurbHe: "קבצים ותיקיות" },
  { slug: "todoist", nameHe: "Todoist", blurbHe: "רשימת המשימות היומית" },
  { slug: "canva", nameHe: "Canva", blurbHe: "עיצובים ותבניות" },
];

export const FEATURED_SLUGS: readonly string[] = FEATURED_APPS.map((app) => app.slug);

const BY_SLUG = new Map(FEATURED_APPS.map((app) => [app.slug, app]));

export function featuredApp(slug: string): FeaturedApp | undefined {
  return BY_SLUG.get(slug);
}
