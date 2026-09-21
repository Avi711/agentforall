import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { z } from "zod";
import { urlErrorMessage } from "@/lib/auth/error-messages";
import { safeRedirectPath } from "@/lib/http/safe-redirect";
import { AuthCard } from "@/components/auth/AuthCard";
import { LoginForm } from "./LoginForm";
import { FORM_MODES, type FormMode } from "./modes";

export const metadata: Metadata = {
  title: "כניסה — Agent For All",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ redirect?: string; error?: string; mode?: string }>;

const Mode = z.enum(FORM_MODES);

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getServerSession();
  const { redirect: redirectTo, error, mode } = await searchParams;
  const safeRedirect = safeRedirectPath(redirectTo);

  if (session) {
    redirect(safeRedirect);
  }

  return (
    <AuthCard title="כניסה ל-Agent For All" subtitle="הסוכן האישי שלכם, באוואטסאפ שלכם.">
      <LoginForm redirectTo={safeRedirect} initialMode={initialMode(mode, error)} initialError={urlErrorMessage(error)} />
    </AuthCard>
  );
}

// A blocked Google sign-in means a pending password sign-up holds the email; choosing a new password clears it.
function initialMode(mode: unknown, error: unknown): FormMode {
  if (error === "account_not_linked") return "forgot";
  const parsed = Mode.safeParse(mode);
  return parsed.success ? parsed.data : "signin";
}
