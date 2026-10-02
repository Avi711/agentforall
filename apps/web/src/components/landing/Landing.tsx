import { Footer, FinalCta } from "./Closing";
import { Compare } from "./Compare";
import { Connectors } from "./Connectors";
import { Day } from "./Day";
import { Faq } from "./Faq";
import { Header } from "./Header";
import { Hero } from "./Hero";
import { Night } from "./Night";
import { Pricing } from "./Pricing";
import { Proof } from "./Proof";
import { Setup } from "./Setup";
import { StickyCta } from "./StickyCta";
import { Trust } from "./Trust";
import { REPLAY_READABLE_CLASS } from "@/lib/analytics/privacy";

export function Landing() {
  return (
    <div className={`${REPLAY_READABLE_CLASS} landing min-h-screen overflow-x-clip bg-(--page) text-(--ink) selection:bg-terra/25`}>
      <Header />
      <main id="main">
        <Hero />
        <Proof />
        <Day />
        <Connectors />
        <Night />
        <Setup />
        <Compare />
        <Pricing />
        <Trust />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <StickyCta />
    </div>
  );
}
