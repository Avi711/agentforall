import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import { MetaPixel } from "@/components/MetaPixel";
import "./globals.css";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  display: "swap",
  variable: "--font-heebo",
});

export const metadata: Metadata = {
  title: "Agent For All — העוזר האישי החכם שלך בוואטסאפ וטלגרם",
  description:
    "עוזר אישי מבוסס בינה מלאכותית שחי בוואטסאפ או בטלגרם שלך. מנהל יומן, תקציב, תזכורות ועוד. זמין 24/7.",
  openGraph: {
    title: "Agent For All — העוזר האישי החכם שלך",
    description:
      "עוזר אישי מבוסס בינה מלאכותית שחי בוואטסאפ או בטלגרם שלך. זמין 24/7.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="bg-cream font-[family-name:var(--font-heebo)] text-espresso antialiased">
        <MetaPixel />
        {children}
      </body>
    </html>
  );
}
