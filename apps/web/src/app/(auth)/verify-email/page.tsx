import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { safeRedirectPath } from "@/lib/http/safe-redirect";
import { AuthCard } from "@/components/auth/AuthCard";
import { AUTH_LINK, AUTH_PRIMARY } from "@/components/auth/styles";
import { VerifyEmailForm } from "./VerifyEmailForm";

export const metadata: Metadata = {
  title: "אישור המייל — Agent For All",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type SearchParams = Promise<{ token?: string; callbackURL?: string }>;

const TokenPayload = z.object({ email: z.string().email(), exp: z.number() });

export default async function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const { token, callbackURL } = await searchParams;
  const payload = typeof token === "string" ? readToken(token) : null;

  return (
    <AuthCard title="אישור כתובת המייל">
      {token && payload && payload.exp * 1000 > Date.now() ? (
        <VerifyEmailForm token={token} email={payload.email} callbackURL={safeRedirectPath(callbackURL, "/login")} />
      ) : payload ? (
        <div className="text-center space-y-4">
          <p className="text-espresso-light leading-relaxed">
            פג תוקף קישור האישור. אם לא אישרתם תוך יממה, ההרשמה בוטלה, ואפשר להירשם שוב עם אותה כתובת.
          </p>
          <Link href="/login?mode=signup" className={`block ${AUTH_PRIMARY}`}>הרשמה מחדש</Link>
          <Link href="/login" className={`text-sm ${AUTH_LINK}`}>למסך הכניסה</Link>
        </div>
      ) : (
        <div className="text-center space-y-4">
          <p className="text-espresso-light">הקישור חסר או פגום. אפשר לבקש קישור חדש במסך הכניסה.</p>
          <Link href="/login" className={`text-sm ${AUTH_LINK}`}>למסך הכניסה</Link>
        </div>
      )}
    </AuthCard>
  );
}

// Display only: Better Auth checks the signature when the form submits.
function readToken(token: string): z.infer<typeof TokenPayload> | null {
  try {
    const payload = token.split(".")[1] ?? "";
    const parsed = TokenPayload.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
