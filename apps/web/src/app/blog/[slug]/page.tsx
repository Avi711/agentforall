import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer } from "@/components/Footer";
import { Navbar } from "@/components/Navbar";
import { PlatformGuide } from "@/components/blog/PlatformGuide";
import { TalkToUs } from "@/components/TalkToUs";
import { POST_SLUGS, isPostSlug, loadPost, type Post } from "@/lib/blog";
import { SITE_NAME, SITE_URL } from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return POST_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!isPostSlug(slug)) return {};
  const { meta } = await loadPost(slug);
  const url = `${SITE_URL}/blog/${slug}`;
  return {
    title: `${meta.title} — ${SITE_NAME}`,
    description: meta.description,
    keywords: meta.keywords,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: meta.title,
      description: meta.description,
      url,
      locale: "he_IL",
      siteName: SITE_NAME,
      publishedTime: meta.publishedAt,
      images: [{ url: `${SITE_URL}${meta.cover.src}`, width: 1600, height: 900, alt: meta.cover.alt }],
    },
    twitter: { card: "summary_large_image", title: meta.title, description: meta.description, images: [`${SITE_URL}${meta.cover.src}`] },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isPostSlug(slug)) notFound();
  const post = await loadPost(slug);
  const { meta, Content } = post;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData(post)) }} />
      <Navbar />
      <main id="main" className="px-5 pb-16 pt-28 sm:px-8 sm:pt-36">
        <article className="mx-auto max-w-3xl">
          <nav aria-label="פירורי לחם" className="text-sm text-espresso-light">
            <Link href="/blog" className="font-medium text-terra hover:underline">
              הבלוג
            </Link>
            <span className="mx-2 text-sand">/</span>
            <span>{meta.title}</span>
          </nav>
          <h1 className="font-display mt-6 text-4xl leading-[1.15] text-espresso sm:text-5xl">{meta.title}</h1>
          <p className="mt-5 text-lg leading-relaxed text-espresso-light">{meta.description}</p>
          <p className="mt-4 text-sm text-espresso-light/80">
            <time dateTime={meta.publishedAt}>{formatHebrewDate(meta.publishedAt)}</time> · {meta.readingMinutes} דקות קריאה
          </p>
          <Image
            src={meta.cover.src}
            alt={meta.cover.alt}
            width={1600}
            height={900}
            priority
            sizes="(max-width: 768px) 100vw, 768px"
            className="mt-8 w-full rounded-[24px] border border-sand-light"
          />

          <PlatformGuide>
            <div className="mt-4">
              <Content />
            </div>
          </PlatformGuide>

          {meta.faq.length > 0 ? (
            <section aria-labelledby="post-faq" className="mt-14">
              <h2 id="post-faq" className="font-display text-2xl text-espresso sm:text-3xl">
                שאלות נפוצות
              </h2>
              <dl className="mt-6 divide-y divide-sand-light">
                {meta.faq.map((item) => (
                  <div key={item.q} className="py-5">
                    <dt className="font-bold text-espresso">{item.q}</dt>
                    <dd className="mt-2 leading-relaxed text-espresso-light">{item.a}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          <div className="mt-14 rounded-[24px] bg-terra-pale/60 px-6 py-8 text-center sm:px-10">
            <p className="font-display text-2xl text-espresso">רוצים סוכן כזה לעצמכם?</p>
            <p className="mt-2 text-espresso-light">7 ימי ניסיון, בלי כרטיס אשראי.</p>
            <Link
              href="/app"
              className="mt-5 inline-flex rounded-full bg-terra px-7 py-3 text-base font-bold text-white transition hover:bg-espresso"
            >
              רוצה סוכן
            </Link>
          </div>
        </article>
      </main>
      <TalkToUs />
      <Footer />
    </>
  );
}

function structuredData(post: Post) {
  const url = `${SITE_URL}/blog/${post.slug}`;
  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.meta.title,
    description: post.meta.description,
    inLanguage: "he-IL",
    datePublished: post.meta.publishedAt,
    image: `${SITE_URL}${post.meta.cover.src}`,
    mainEntityOfPage: url,
    author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "הבלוג", item: `${SITE_URL}/blog` },
      { "@type": "ListItem", position: 2, name: post.meta.title, item: url },
    ],
  };
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: post.meta.faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
  return post.meta.faq.length > 0 ? [article, breadcrumb, faq] : [article, breadcrumb];
}

const hebrewDate = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jerusalem" });

function formatHebrewDate(iso: string): string {
  return hebrewDate.format(new Date(iso));
}
