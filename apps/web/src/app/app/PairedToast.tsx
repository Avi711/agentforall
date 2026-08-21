"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function PairedToast() {
  const router = useRouter();
  const params = useSearchParams();
  const paired = params.get("paired");
  const [visible, setVisible] = useState(Boolean(paired));

  useEffect(() => {
    if (!paired) return;
    const t = setTimeout(() => {
      setVisible(false);
      router.replace("/app");
    }, 5_000);
    return () => clearTimeout(t);
  }, [paired, router]);

  if (!visible) return null;
  return (
    <div className="fixed top-20 inset-x-0 flex justify-center px-4 z-50 pointer-events-none">
      <div className="max-w-full bg-sage text-white text-sm sm:text-base px-5 py-3 rounded-xl shadow-lg font-medium text-center pointer-events-auto">
        ✓ WhatsApp חובר בהצלחה — הבוט שלכם פעיל
      </div>
    </div>
  );
}
