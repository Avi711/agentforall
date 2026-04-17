import type { Metadata } from "next";
import { Heebo, Secular_One } from "next/font/google";
import { MetaPixel } from "@/components/MetaPixel";
import { WhatsAppFloat } from "@/components/WhatsAppFloat";
import "./globals.css";

const heebo = Heebo({
  subsets: ["hebrew"],
  display: "swap",
  variable: "--font-heebo",
});

const secular = Secular_One({
  subsets: ["hebrew"],
  display: "swap",
  weight: ["400"],
  variable: "--font-display",
});

const siteUrl = "https://agentforall.co.il";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Agent For All — העוזר האישי החכם שלך בוואטסאפ וטלגרם",
  description:
    "עוזר אישי מבוסס בינה מלאכותית שחי בוואטסאפ או בטלגרם שלך. מנהל יומן, תקציב, תזכורות, מילואים וקופת חולים. זמין 24/7. מ-99 ש״ח לחודש, כולל מע״מ.",
  openGraph: {
    title: "Agent For All — העוזר האישי החכם שלך",
    description:
      "סוכן AI אישי בוואטסאפ או טלגרם. זמין 24/7. מ-99 ש״ח/חודש, כולל מע״מ.",
    type: "website",
    locale: "he_IL",
    url: siteUrl,
    siteName: "Agent For All",
  },
  twitter: {
    card: "summary_large_image",
    title: "Agent For All — העוזר האישי החכם שלך",
    description: "סוכן AI אישי בוואטסאפ. זמין 24/7. מ-99 ש״ח/חודש.",
  },
  alternates: {
    canonical: siteUrl,
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Agent For All",
  url: siteUrl,
  logo: `${siteUrl}/logo.png`,
  description: "סוכן AI אישי בוואטסאפ וטלגרם",
  areaServed: {
    "@type": "Country",
    name: "Israel",
  },
  contactPoint: {
    "@type": "ContactPoint",
    telephone: "+972-55-250-6938",
    contactType: "customer service",
    availableLanguage: ["Hebrew", "English"],
  },
  offers: {
    "@type": "Offer",
    priceCurrency: "ILS",
    price: "99",
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: "99",
      priceCurrency: "ILS",
      unitText: "MONTH",
      valueAddedTaxIncluded: true,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he-IL" dir="rtl" className={`${heebo.variable} ${secular.variable}`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body className="bg-cream font-[family-name:var(--font-heebo)] text-espresso antialiased">
        <MetaPixel />
        {children}
        <WhatsAppFloat />
      </body>
    </html>
  );
}
