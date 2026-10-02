"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { isUnder } from "@/lib/analytics/privacy";

// Conversions go server-side; these screens carry URL tokens or customer data the Pixel's automatic matching would read.
const UNTRACKED_SECTIONS = ["/app", "/admin", "/login", "/reset-password", "/verify-email"];

export function MetaPixel({ pixelId }: { pixelId: string | null }) {
  const pathname = usePathname();
  if (!pixelId || UNTRACKED_SECTIONS.some((section) => isUnder(pathname, section))) return null;

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${pixelId}');
          fbq('track', 'PageView');
        `}
      </Script>
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
    </>
  );
}
