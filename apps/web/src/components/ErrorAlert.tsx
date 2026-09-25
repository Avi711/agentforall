import type { ReactNode } from "react";

export function ErrorAlert({ children, className = "" }: { children: ReactNode; className?: string }) {
  if (!children) return null;
  return <p role="alert" className={`rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 ${className}`}>{children}</p>;
}
