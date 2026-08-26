import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { Features } from "@/components/Features";
import { HowItWorks } from "@/components/HowItWorks";
import { Testimonials } from "@/components/Testimonials";
import { Comparison } from "@/components/Comparison";
import { Pricing } from "@/components/Pricing";
import { LeadForm } from "@/components/LeadForm";
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
        <Disclaimer />
        <Features />
        <HowItWorks />
        <Testimonials />
        <Comparison />
        <Pricing />
        <LeadForm />
        <FAQ />
      </main>
      <Footer />
    </>
  );
}
