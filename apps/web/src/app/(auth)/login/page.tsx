import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "כניסה — Agent For All",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ redirect?: string }>;

// Rejects `//evil.com` and `/\evil.com` (browser-interpreted as protocol-relative).
const SAFE_REDIRECT_RE = /^\/[^/\\]/;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getServerSession();
  const { redirect: redirectTo } = await searchParams;
  const safeRedirect =
    redirectTo && SAFE_REDIRECT_RE.test(redirectTo) ? redirectTo : "/app";

  if (session) {
    redirect(safeRedirect);
  }

  return (
    <main className="min-h-screen bg-cream flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="mb-10 text-center">
          <h1 className="font-display text-4xl text-espresso mb-3">
            כניסה ל-Agent For All
          </h1>
          <p className="text-espresso-light">
            הסוכן האישי שלכם, באוואטסאפ שלכם.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-8 border border-sand-light">
          <LoginForm redirectTo={safeRedirect} />
        </div>

        <p className="mt-6 text-center text-sm text-espresso-light">
          אין לכם עדיין חשבון? הכניסה הראשונה יוצרת אותו אוטומטית.
        </p>
      </div>
    </main>
  );
}
