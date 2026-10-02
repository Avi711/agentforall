import type { ReactNode } from "react";
import { REPLAY_READABLE_CLASS } from "@/lib/analytics/privacy";

export function ReplayReadable({ children }: { children: ReactNode }) {
  return <div className={`${REPLAY_READABLE_CLASS} contents`}>{children}</div>;
}
