import type { MDXComponents } from "mdx/types";
import type { ComponentType } from "react";

export interface PostImage {
  src: string;
  alt: string;
}

export interface PostFaq {
  q: string;
  a: string;
}

export type DevicePlatform = "ios" | "android";

export interface VideoChapter {
  label: string;
  startSec: number;
}

// Paths are relative to MEDIA_CDN_URL.
export interface PlatformVideo {
  preview: string;
  sd: string;
  hd: string;
  poster: string;
  durationSec: number;
  chapters: VideoChapter[];
}

export interface PostVideo {
  title: string;
  description: string;
  // ISO date.
  uploadedAt: string;
  byPlatform: Record<DevicePlatform, PlatformVideo>;
}

export interface GuideStep {
  id: string;
  title: string;
  summary: string;
}

export interface GuideSection {
  id: string;
  label: string;
}

export interface PostGuide {
  eyebrow: string;
  // A shorter intro than the meta description, which stays for search results.
  lede: string;
  duration: string;
  needs: string[];
  sections: GuideSection[];
  steps: GuideStep[];
}

export interface PostMeta {
  title: string;
  description: string;
  // ISO date.
  publishedAt: string;
  readingMinutes: number;
  keywords: string[];
  cover: PostImage;
  faq: PostFaq[];
  video?: PostVideo;
  guide?: PostGuide;
}

export type PostContent = ComponentType<{ components?: MDXComponents }>;

export interface Post {
  slug: string;
  meta: PostMeta;
  Content: PostContent;
}

// Newest first. Adding a post = one MDX file in src/content/blog plus its slug here.
export const POST_SLUGS = [
  "teach-your-agent-to-talk-to-customers",
  "dedicated-whatsapp-number",
  "what-is-a-personal-ai-agent",
  "how-much-does-a-personal-ai-agent-cost",
  "whatsapp-ai-agent-what-it-can-do",
  "telegram-or-whatsapp-for-your-agent",
  "ai-agent-for-small-business",
  "customer-service-bot-vs-personal-agent",
  "openclaw-hebrew-guide",
  "privacy-where-your-data-lives",
] as const;

export type PostSlug = (typeof POST_SLUGS)[number];

export function isPostSlug(value: string): value is PostSlug {
  return (POST_SLUGS as readonly string[]).includes(value);
}

export async function loadPost(slug: PostSlug): Promise<Post> {
  const mod = (await import(`@/content/blog/${slug}.mdx`)) as { default: PostContent; metadata: PostMeta };
  return { slug, meta: mod.metadata, Content: mod.default };
}

export async function loadAllPosts(): Promise<Post[]> {
  return Promise.all(POST_SLUGS.map(loadPost));
}
