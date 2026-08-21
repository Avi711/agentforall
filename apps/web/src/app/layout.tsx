import type { Metadata, Viewport } from "next";
import { Heebo, Secular_One } from "next/font/google";
import { MetaPixel } from "@/components/MetaPixel";
import { WhatsAppFloat } from "@/components/WhatsAppFloat";
import { AccessibilityWidget } from "@/components/AccessibilityWidget";
import {
  SITE_NAME,
  SITE_PHONE,
  SITE_URL,
  PRICE_ILS_MONTHLY,
  SITE_KEYWORDS,
  SITE_ALTERNATE_NAMES,
} from "@/lib/site";
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

const siteUrl = SITE_URL;
const ogImage = {
  url: "/logo.png",
  width: 800,
  height: 800,
  alt: "Agent For All",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Agent For All — העוזר האישי החכם שלך בוואטסאפ וטלגרם",
  description:
    "עוזר אישי מבוסס בינה מלאכותית שחי בוואטסאפ או בטלגרם שלך. מנהל יומן, תקציב, תזכורות, מילואים וקופת חולים. זמין 24/7. מ-199 ש״ח לחודש, כולל מע״מ.",
  keywords: SITE_KEYWORDS,
  openGraph: {
    title: "Agent For All — העוזר האישי החכם שלך",
    description:
      "סוכן AI אישי בוואטסאפ או טלגרם. זמין 24/7. מ-199 ש״ח/חודש, כולל מע״מ.",
    type: "website",
    locale: "he_IL",
    url: siteUrl,
    siteName: "Agent For All",
    images: [ogImage],
  },
  twitter: {
    card: "summary_large_image",
    title: "Agent For All — העוזר האישי החכם שלך",
    description: "סוכן AI אישי בוואטסאפ. זמין 24/7. מ-199 ש״ח/חודש.",
    images: [ogImage.url],
  },
  alternates: {
    canonical: siteUrl,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximumScale/userScalable cap — pinch-zoom is an IL AA accessibility requirement.
  themeColor: "#FBF8F3",
  colorScheme: "light",
};

// One @graph so answer engines resolve publisher, site and product as one entity set.
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: SITE_NAME,
      alternateName: SITE_ALTERNATE_NAMES,
      url: siteUrl,
      logo: {
        "@type": "ImageObject",
        url: `${siteUrl}/logo.png`,
        width: 800,
        height: 800,
      },
      description: "סוכן AI אישי בוואטסאפ וטלגרם",
      areaServed: { "@type": "Country", name: "Israel" },
      contactPoint: {
        "@type": "ContactPoint",
        telephone: SITE_PHONE,
        contactType: "customer service",
        availableLanguage: ["Hebrew", "English"],
      },
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      url: siteUrl,
      name: SITE_NAME,
      inLanguage: "he-IL",
      publisher: { "@id": `${siteUrl}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${siteUrl}/#product`,
      name: SITE_NAME,
      alternateName: SITE_ALTERNATE_NAMES,
      keywords: SITE_KEYWORDS.join(", "),
      applicationCategory: "BusinessApplication",
      operatingSystem: "WhatsApp, Telegram",
      inLanguage: "he-IL",
      url: siteUrl,
      provider: { "@id": `${siteUrl}/#organization` },
      audience: [
        { "@type": "Audience", audienceType: "יחידים ומשפחות" },
        { "@type": "Audience", audienceType: "עצמאים ופרילנסרים" },
        { "@type": "BusinessAudience", audienceType: "עסקים קטנים" },
      ],
      description:
        "עוזר אישי מבוסס בינה מלאכותית שחי בוואטסאפ או בטלגרם: ניהול יומן, מעקב הוצאות, תזכורות, מחקר וניסוח הודעות. זמין 24/7, ללא התקנה.",
      featureList: [
        "ניהול יומן",
        "מעקב הוצאות ותקציב",
        "תזכורות",
        "מחקר ובדיקת עובדות",
        "ניסוח הודעות",
        "פעילות בקבוצות",
      ],
      offers: {
        "@type": "Offer",
        priceCurrency: "ILS",
        price: PRICE_ILS_MONTHLY,
        availability: "https://schema.org/InStock",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: PRICE_ILS_MONTHLY,
          priceCurrency: "ILS",
          unitText: "MONTH",
          valueAddedTaxIncluded: true,
        },
      },
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he-IL" dir="rtl" className={`${heebo.variable} ${secular.variable}`}>
      <body
        className="bg-cream font-[family-name:var(--font-heebo)] text-espresso antialiased"
        suppressHydrationWarning
      >
        <a href="#main" className="skip-link">דלג לתוכן הראשי</a>
        <MetaPixel />
        {children}
        <WhatsAppFloat />
        <AccessibilityWidget />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </body>
    </html>
  );
}
