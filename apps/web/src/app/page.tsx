import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { Features } from "@/components/Features";
import { HowItWorks } from "@/components/HowItWorks";
import { Comparison } from "@/components/Comparison";
import { Pricing } from "@/components/Pricing";
import { TalkToUs } from "@/components/TalkToUs";
import { FAQ } from "@/components/FAQ";
import { Footer } from "@/components/Footer";
import { Disclaimer } from "@/components/Disclaimer";
import { faqs } from "@/content/faq.he";

const faqStructuredData = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.q,
    acceptedAnswer: { "@type": "Answer", text: faq.a },
  })),
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqStructuredData) }}
      />
      <Navbar />
      <main id="main">
        <Hero />
        <Features />
        <HowItWorks />
        <Comparison />
        <Disclaimer />
        <Pricing />
        <TalkToUs />
        <FAQ />
      </main>
      <Footer />
    </>
  );
}
