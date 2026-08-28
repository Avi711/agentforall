import type { ComponentType } from "react";

export interface PostImage {
  src: string;
  alt: string;
}

export interface PostFaq {
  q: string;
  a: string;
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
}

export interface Post {
  slug: string;
  meta: PostMeta;
  Content: ComponentType;
}

// Newest first. Adding a post = one MDX file in src/content/blog plus its slug here.
export const POST_SLUGS = [
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
  const mod = (await import(`@/content/blog/${slug}.mdx`)) as { default: ComponentType; metadata: PostMeta };
  return { slug, meta: mod.metadata, Content: mod.default };
}

export async function loadAllPosts(): Promise<Post[]> {
  return Promise.all(POST_SLUGS.map(loadPost));
}
