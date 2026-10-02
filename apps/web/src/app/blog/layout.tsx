import type { ReactNode } from "react";
import { ReplayReadable } from "@/components/ReplayReadable";

export default function BlogLayout({ children }: { children: ReactNode }) {
  return <ReplayReadable>{children}</ReplayReadable>;
}
