"use client";

import { useEffect } from "react";
import { identifyUser } from "@/lib/analytics/client";

export function AnalyticsIdentity({ userId }: { userId: string }) {
  useEffect(() => {
    identifyUser(userId);
  }, [userId]);

  return null;
}
