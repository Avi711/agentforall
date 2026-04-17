import type { ReactNode } from "react";
import Link from "next/link";
import { Footer } from "./Footer";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <>
      <main id="main" className="min-h-screen px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-3xl">
          <Link href="/" className="text-sm font-medium text-terra hover:underline">
            ← חזרה לעמוד הראשי
          </Link>

          <h1 className="font-display mt-6 text-4xl font-black leading-[1.1] tracking-tight text-espresso sm:text-5xl">
            {title}
          </h1>
          <p className="mt-3 text-sm text-espresso-light">
            עודכן לאחרונה: {updated}
          </p>

          <div className="mt-10 space-y-8 leading-relaxed text-espresso-light">
            {children}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

export function WhatsAppLink({ text = "055-250-6938" }: { text?: string }) {
  return (
    <a
      href="https://wa.me/972552506938"
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-terra hover:underline"
    >
      {text}
      <span className="sr-only"> (נפתח בחלון חדש)</span>
    </a>
  );
}
