"use client";

import { useEffect, useRef } from "react";
import { useCopy } from "@/lib/use-copy";
import { AUTH_SECONDARY } from "./styles";

export function InAppBrowserNotice({ url }: { url: string }) {
  const titleRef = useRef<HTMLParagraphElement>(null);
  const { copied, copy } = useCopy(url);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <div className="space-y-3 rounded-xl border border-sand bg-cream p-4 text-sm text-espresso">
      <p ref={titleRef} tabIndex={-1} className="font-medium focus:outline-none">
        כדי להתחבר עם גוגל, פתחו את העמוד בדפדפן
      </p>
      <p className="leading-relaxed text-espresso-light">
        גוגל לא מאפשרת להתחבר מתוך הדפדפן של אפליקציות כמו אינסטגרם ופייסבוק. הקישו על שלוש הנקודות בפינת המסך ובחרו לפתוח
        בדפדפן, או העתיקו את הקישור והדביקו אותו בדפדפן.
      </p>
      <div className="flex gap-2">
        <p dir="ltr" className="min-w-0 flex-1 select-all truncate rounded-xl border border-sand bg-white px-3 py-3 text-left leading-6 text-espresso-light">
          {url}
        </p>
        <button type="button" onClick={copy ?? undefined} aria-label="העתקת הקישור" className={`shrink-0 ${AUTH_SECONDARY}`}>
          {copied ? "הועתק" : "העתקה"}
          <span className="sr-only" aria-live="polite">
            {copied ? "הועתק" : ""}
          </span>
        </button>
      </div>
    </div>
  );
}
