export interface FeaturedApp {
  slug: string;
  nameHe: string;
  blurbHe: string;
}

// Shown first, in this order, with Hebrew copy; the rest of the catalog stays searchable in English.
// Mail, calendar, contacts and files — what a personal assistant needs, not the provider's usage ranking,
// which is developer-weighted (GitHub second, Supabase seventh).
export const FEATURED_APPS: readonly FeaturedApp[] = [
  { slug: "gmail", nameHe: "Gmail", blurbHe: "לקרוא, לחפש ולשלוח מיילים" },
  { slug: "googlecalendar", nameHe: "יומן Google", blurbHe: "לקבוע פגישות ולבדוק מה יש היום" },
  { slug: "googlecontacts", nameHe: "אנשי קשר Google", blurbHe: "למצוא מספרים וכתובות" },
  { slug: "googledrive", nameHe: "Google Drive", blurbHe: "לחפש ולקרוא קבצים" },
  { slug: "googledocs", nameHe: "Google Docs", blurbHe: "לכתוב ולערוך מסמכים" },
  { slug: "googlesheets", nameHe: "Google Sheets", blurbHe: "לקרוא ולעדכן גיליונות" },
  { slug: "googletasks", nameHe: "משימות Google", blurbHe: "משימות ורשימות" },
  { slug: "googlephotos", nameHe: "Google Photos", blurbHe: "לחפש תמונות" },
  { slug: "outlook", nameHe: "Outlook", blurbHe: "מייל ויומן של Microsoft" },
  { slug: "one_drive", nameHe: "OneDrive", blurbHe: "קבצים של Microsoft" },
  { slug: "dropbox", nameHe: "Dropbox", blurbHe: "קבצים ותיקיות" },
  { slug: "notion", nameHe: "Notion", blurbHe: "דפים, טבלאות ורשימות" },
  { slug: "todoist", nameHe: "Todoist", blurbHe: "רשימת המשימות היומית" },
  { slug: "calendly", nameHe: "Calendly", blurbHe: "לתאם פגישות עם אחרים" },
  { slug: "monday", nameHe: "monday.com", blurbHe: "לוחות עבודה ומשימות" },
  { slug: "wix", nameHe: "Wix", blurbHe: "האתר והבלוג שלכם" },
  { slug: "linkedin", nameHe: "LinkedIn", blurbHe: "לפרסם פוסטים ולמצוא אנשים" },
  { slug: "zoom", nameHe: "Zoom", blurbHe: "פגישות וידאו וסיכומים" },
  { slug: "canva", nameHe: "Canva", blurbHe: "עיצובים ותבניות" },
  { slug: "docusign", nameHe: "DocuSign", blurbHe: "חתימה על מסמכים וחוזים" },
];

// Shown as logos on the dashboard card: visually distinct, and recognised without reading.
// The dashboard's logo strip is decoration with a fixed cast, so it ships as local assets: asking
// the orchestrator for six logos put Composio's catalog refill (~9s cold) on the dashboard's path.
export interface ShowcaseApp {
  slug: string;
  name: string;
  logo: string;
}

export const SHOWCASE_APPS: readonly ShowcaseApp[] = [
  { slug: "gmail", name: "Gmail", logo: "/apps/gmail.webp" },
  { slug: "googlecalendar", name: "יומן Google", logo: "/apps/googlecalendar.webp" },
  { slug: "googledrive", name: "Google Drive", logo: "/apps/googledrive.webp" },
  { slug: "notion", name: "Notion", logo: "/apps/notion.webp" },
  { slug: "monday", name: "monday.com", logo: "/apps/monday.webp" },
  { slug: "wix", name: "Wix", logo: "/apps/wix.webp" },
];

export const FEATURED_SLUGS: readonly string[] = FEATURED_APPS.map((app) => app.slug);

const BY_SLUG = new Map(FEATURED_APPS.map((app) => [app.slug, app]));

export function featuredApp(slug: string): FeaturedApp | undefined {
  return BY_SLUG.get(slug);
}

// The provider's catalog is English only, so a Hebrew query is matched against our own copy.
export function searchFeatured(query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return FEATURED_APPS.filter(
    (app) => app.nameHe.toLowerCase().includes(needle) || app.blurbHe.toLowerCase().includes(needle),
  ).map((app) => app.slug);
}
