import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — עוזר אישי חכם בוואטסאפ וטלגרם`,
    short_name: SITE_NAME,
    description:
      "עוזר אישי מבוסס בינה מלאכותית שחי בוואטסאפ או בטלגרם שלכם: יומן, תקציב, תזכורות ומחקר — זמין 24/7.",
    start_url: "/",
    display: "standalone",
    lang: "he-IL",
    dir: "rtl",
    background_color: "#FBF8F3",
    theme_color: "#C7522A",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any", purpose: "any" },
      { src: "/logo.png", type: "image/png", sizes: "800x800", purpose: "any" },
    ],
  };
}
