"use client";

import Script from "next/script";

const RAW_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;
// Numeric check guards the inline script below from env-var injection.
const PIXEL_ID = RAW_PIXEL_ID && /^\d+$/.test(RAW_PIXEL_ID) ? RAW_PIXEL_ID : undefined;

export function MetaPixel() {
  if (!PIXEL_ID) return null;

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
          fbq('init', '${PIXEL_ID}');
          fbq('track', 'PageView');
        `}
      </Script>
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
    </>
  );
}

export interface TrackLeadArgs {
  eventId: string;
  email?: string;
  phone?: string;
  name?: string;
}

// Fires a deduplicated Lead event. eventId MUST be forwarded to the server so
// Meta can collapse the Pixel event with the matching Conversions API event
// (dedup window: 48h on event_name + event_id).
export function trackLead(args: TrackLeadArgs): void {
  if (typeof window === "undefined" || typeof window.fbq !== "function" || !PIXEL_ID) {
    return;
  }

  // Re-init with customer data so Meta hashes it client-side for Advanced
  // Matching. This raises the EMQ score even when the server event is blocked.
  const matching: FbqAdvancedMatching = {};
  if (args.email) matching.em = args.email;
  if (args.phone) matching.ph = args.phone;
  if (args.name) {
    const [first, ...rest] = args.name.trim().split(/\s+/).filter(Boolean);
    if (first) matching.fn = first;
    if (rest.length > 0) matching.ln = rest.join(" ");
  }
  if (Object.keys(matching).length > 0) {
    window.fbq("init", PIXEL_ID, matching);
  }

  window.fbq("track", "Lead", {}, { eventID: args.eventId });
}
