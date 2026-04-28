// Mirrors packages/db/src/schema/leads.ts — inlined so this stays client-safe (db pulls pg).
export const PLATFORMS = ["whatsapp", "telegram", "both"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS_HE: Record<Platform, string> = {
  whatsapp: "וואטסאפ",
  telegram: "טלגרם",
  both: "שניהם",
};

export const PLATFORM_OPTIONS_HE: ReadonlyArray<{
  value: Platform;
  label: string;
}> = PLATFORMS.map((value) => ({ value, label: PLATFORM_LABELS_HE[value] }));
