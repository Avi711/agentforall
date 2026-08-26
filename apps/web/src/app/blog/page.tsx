import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Navbar } from "@/components/Navbar";
import { loadAllPosts } from "@/lib/blog";
import { SITE_NAME, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: `הבלוג — ${SITE_NAME}`,
  description: "מדריכים והסברים בעברית על סוכני AI אישיים: מה הם עושים, כמה זה עולה, וואטסאפ מול טלגרם, OpenClaw ופרטיות.",
  alternates: { canonical: `${SITE_URL}/blog` },
  openGraph: { type: "website", url: `${SITE_URL}/blog`, title: `הבלוג — ${SITE_NAME}`, locale: "he_IL", siteName: SITE_NAME },
};

export default async function BlogIndexPage() {
  const posts = await loadAllPosts();
  const [featured, ...rest] = posts;

  return (
    <>
      <Navbar />
      <main id="main" className="px-5 pb-24 pt-28 sm:px-8 sm:pt-36">
        <div className="mx-auto max-w-5xl">
          <header className="mb-12 max-w-2xl">
            <p className="mb-3 text-xs uppercase tracking-[0.22em] text-espresso-light/80">הבלוג</p>
            <h1 className="font-display text-4xl leading-tight text-espresso sm:text-5xl">סוכן AI אישי, בלי הבאזז</h1>
            <p className="mt-4 text-lg leading-relaxed text-espresso-light">
              מה זה באמת, מה הוא עושה ביום-יום, כמה זה עולה ואיפה הנתונים שלכם יושבים. בעברית, בגובה העיניים.
            </p>
          </header>

          {featured ? <PostCard post={featured} featured /> : null}

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            {rest.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

function PostCard({ post, featured = false }: { post: Awaited<ReturnType<typeof loadAllPosts>>[number]; featured?: boolean }) {
  const { meta, slug } = post;
  return (
    <Link
      href={`/blog/${slug}`}
      className={`group block overflow-hidden rounded-[24px] border border-sand-light bg-white shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] transition hover:-translate-y-0.5 ${
        featured ? "sm:grid sm:grid-cols-2" : ""
      }`}
    >
      <Image
        src={meta.cover.src}
        alt=""
        width={1600}
        height={900}
        sizes={featured ? "(max-width: 640px) 100vw, 50vw" : "(max-width: 640px) 100vw, 33vw"}
        className={featured ? "aspect-[16/9] w-full object-cover sm:aspect-auto sm:h-full" : "aspect-[16/9] w-full object-cover"}
      />
      <div className="p-6 sm:p-8">
        <p className="text-xs text-espresso-light/80">
          <time dateTime={meta.publishedAt}>{hebrewDate.format(new Date(meta.publishedAt))}</time> · {meta.readingMinutes} דקות
        </p>
        <h2 className={`font-display mt-2 text-espresso group-hover:text-terra ${featured ? "text-3xl" : "text-2xl"}`}>{meta.title}</h2>
        <p className="mt-3 leading-relaxed text-espresso-light">{meta.description}</p>
      </div>
    </Link>
  );
}

const hebrewDate = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jerusalem" });
