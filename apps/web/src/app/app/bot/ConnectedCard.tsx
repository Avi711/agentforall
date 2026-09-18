import type { ReactNode } from "react";
import { PendingLink } from "@/app/app/Pending";
import { FLOW_BUTTON } from "./flow-buttons";

interface Props {
  title: string;
  children: ReactNode;
  // Opens the chat with the bot; absent when there is nowhere to send the owner.
  chat?: { href: string; label: string; icon?: ReactNode };
}

// The closing screen of every connect flow. The home link replaces history so Back never re-enters a finished flow.
export function ConnectedCard({ title, children, chat }: Props) {
  return (
    <div className="mx-auto max-w-md space-y-5 rounded-[24px] border border-sand-light bg-white p-6 text-center shadow-sm sm:p-10">
      <span
        aria-hidden
        className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-sage-pale text-2xl text-sage-dark"
      >
        ✓
      </span>
      <h2 className="font-display text-2xl text-espresso">{title}</h2>
      <div className="leading-relaxed text-espresso-light">{children}</div>
      {/* The secondary comes first so the primary lands far left, where an RTL row ends. */}
      <div className="flex flex-wrap-reverse justify-center gap-3 pt-1">
        <PendingLink href="/app" replace className={FLOW_BUTTON.secondary}>
          לדשבורד
        </PendingLink>
        {chat ? (
          <a href={chat.href} target="_blank" rel="noopener noreferrer" className={FLOW_BUTTON.primary}>
            {chat.icon}
            <span>{chat.label}</span>
          </a>
        ) : null}
      </div>
    </div>
  );
}
