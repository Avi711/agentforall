"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Toast } from "./Toast";

export function PairedToast() {
  const router = useRouter();
  const params = useSearchParams();
  const paired = params.get("paired");
  const [visible, setVisible] = useState(Boolean(paired));

  useEffect(() => {
    if (!paired || !visible) return;
    const t = setTimeout(() => {
      setVisible(false);
      router.replace("/app");
    }, 8_000);
    return () => clearTimeout(t);
  }, [paired, visible, router]);

  return (
    <Toast
      tone="ok"
      text={visible ? "וואטסאפ חובר בהצלחה — הסוכן שלכם פעיל" : null}
      onDismiss={() => {
        setVisible(false);
        router.replace("/app");
      }}
    />
  );
}
