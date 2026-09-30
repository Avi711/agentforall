import type { ReactNode } from "react";
import { SITE_WHATSAPP_URL, whatsappChatUrl } from "@/lib/site";

export function WhatsAppChatLink({
  text,
  className = "underline",
  onClick,
  children,
}: {
  text?: string;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <a href={text ? whatsappChatUrl(text) : SITE_WHATSAPP_URL} target="_blank" rel="noopener noreferrer" onClick={onClick} className={className}>
      {children}
      <span className="sr-only"> (נפתח בחלון חדש)</span>
    </a>
  );
}
