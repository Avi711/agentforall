import type { MetadataRoute } from "next";
import { POST_SLUGS } from "@/lib/blog";
import { SITE_URL } from "@/lib/site";

// Bump when public page content meaningfully changes.
const LAST_CONTENT_UPDATE = new Date("2026-08-26");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, lastModified: LAST_CONTENT_UPDATE, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/privacy`, lastModified: LAST_CONTENT_UPDATE, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: LAST_CONTENT_UPDATE, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/accessibility`, lastModified: LAST_CONTENT_UPDATE, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/blog`, lastModified: LAST_CONTENT_UPDATE, changeFrequency: "weekly", priority: 0.8 },
    ...POST_SLUGS.map((slug) => ({
      url: `${SITE_URL}/blog/${slug}`,
      lastModified: LAST_CONTENT_UPDATE,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
