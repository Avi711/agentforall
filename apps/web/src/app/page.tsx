import { FAQ_STRUCTURED_DATA } from "@/components/landing/content";
import { Landing } from "@/components/landing/Landing";
import "@/components/landing/landing.css";

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_STRUCTURED_DATA) }} />
      <Landing />
    </>
  );
}
