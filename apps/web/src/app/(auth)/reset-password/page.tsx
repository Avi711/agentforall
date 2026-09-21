import type { Metadata } from "next";
import { authErrorMessage } from "@/lib/auth/error-messages";
import { AuthCard } from "@/components/auth/AuthCard";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "בחירת סיסמה חדשה — Agent For All",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type SearchParams = Promise<{ token?: string; error?: string }>;

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const { token, error } = await searchParams;
  const validToken = typeof token === "string" && token.length > 0 ? token : null;
  const linkError =
    typeof error === "string" ? authErrorMessage({ code: error }) : validToken ? null : authErrorMessage({ code: "INVALID_TOKEN" });

  return (
    <AuthCard title="בחירת סיסמה חדשה">
      <ResetPasswordForm token={linkError ? null : validToken} linkError={linkError} />
    </AuthCard>
  );
}
