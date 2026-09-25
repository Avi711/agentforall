import type { ReactNode } from "react";
import { whatsappChatUrl } from "@/lib/site";

export function WhatsAppChatLink({ text, className = "underline", children }: { text: string; className?: string; children: ReactNode }) {
  return (
    <a href={whatsappChatUrl(text)} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}
