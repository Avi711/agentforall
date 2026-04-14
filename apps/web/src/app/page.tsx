import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { Features } from "@/components/Features";
import { HowItWorks } from "@/components/HowItWorks";
import { Testimonials } from "@/components/Testimonials";
import { LeadForm } from "@/components/LeadForm";
import { FAQ } from "@/components/FAQ";
import { Footer } from "@/components/Footer";
import { Disclaimer } from "@/components/Disclaimer";
export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <Disclaimer />
        <Features />
        <HowItWorks />
        <Testimonials />
        <LeadForm />
        <FAQ />
      </main>
      <Footer />
    </>
  );
}
