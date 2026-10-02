"use client";

import { useId, useState, type ReactNode } from "react";
import type { OwnerNumberTarget } from "./OwnerIdentityDialog";
import { ROW_ACTION_CLASS } from "./action-buttons";
import { ChannelOfferTile } from "./ChannelOfferTile";
import { ChevronEnd, TelegramMark, WhatsAppMark } from "./Marks";
import { formatPhoneForDisplay } from "@/lib/phone";
import { PendingLink } from "./Pending";
import type { BotSnapshot } from "./useBotStatus";

export type Channel = "whatsapp" | "telegram" | "whatsapp-cloud";

export interface RowStatus {
  tone: "ok" | "warn" | "err" | "info";
  label: string;
  pulse?: boolean;
}

type Emphasis = "primary" | "quiet" | "plain" | "danger";

type Action = { label: string; emphasis: Emphasis; disabled?: boolean; icon?: ReactNode } & (
  | { kind: "link"; href: string; external?: boolean }
  | { kind: "button"; onClick: () => void }
);

export interface RowModel {
  status: RowStatus;
  connected: boolean;
  pending: boolean;
  stale: boolean;
  primary: Action | null;
}

function lead(action: Action | null, allowed: boolean): Action | null {
  return action && allowed ? { ...action, emphasis: "primary" } : action;
}

// The agent answers the owner's own number, so WhatsApp without it is half-configured.
function ownerNumberMissing(bot: BotSnapshot): boolean {
  return bot.hasWhatsappChannel && bot.owner.whatsappNumber === null;
}

// Container-level health applies to every channel at once.
function channelHealth(bot: BotSnapshot): RowStatus | null {
  if (bot.status === "unhealthy") return { tone: "err", label: "לא מגיב" };
  if (bot.status === "degraded") return { tone: "warn", label: "חיבור לא יציב", pulse: true };
  return null;
}

export function whatsappRow(bot: BotSnapshot, health: RowStatus | null): RowModel {
  const pairing = bot.pairingStatus;
  if (pairing === "paired" && bot.hasWhatsappCreds) {
    const status: RowStatus =
      health ?? (bot.lastSeenAt === null ? { tone: "info", label: "מתחבר…", pulse: true } : { tone: "ok", label: "מחובר" });
    return {
      status,
      connected: true,
      pending: false,
      stale: false,
      primary: bot.whatsappAccountId
        ? {
            kind: "link",
            label: "פתיחה ב-WhatsApp",
            icon: <WhatsAppMark />,
            href: `https://wa.me/${bot.whatsappAccountId}?text=${encodeURIComponent("שלום!")}`,
            external: true,
            emphasis: "quiet",
          }
        : null,
    };
  }
  if (pairing === "awaiting_qr" || pairing === "awaiting_code") {
    return {
      status: { tone: "warn", label: "ממתין להתאמה", pulse: true },
      connected: false,
      pending: true,
      stale: false,
      primary: { kind: "link", label: "המשך התאמה", href: "/app/bot/pair", emphasis: "quiet" },
    };
  }
  // A dropped live session (creds still stored) is worth a reconnect; a cancelled attempt is just "not connected".
  if ((pairing === "expired" || pairing === "failed") && bot.hasWhatsappCreds) {
    return {
      status: { tone: "warn", label: "החיבור נותק" },
      connected: false,
      pending: false,
      stale: true,
      primary: { kind: "link", label: "חיבור מחדש", href: "/app/bot/pair", emphasis: "quiet" },
    };
  }
  return {
    status: { tone: "info", label: "לא מחובר" },
    connected: false,
    pending: false,
    stale: false,
    primary: { kind: "link", label: "חיבור", href: "/app/bot/pair", emphasis: "quiet" },
  };
}

// The business number is opt-in and never the "first channel": its button stays quiet.
export function whatsappCloudRow(bot: BotSnapshot, health: RowStatus | null): RowModel {
  if (bot.whatsappCloud?.health === "token_invalid") {
    return {
      status: { tone: "err", label: "החיבור פג" },
      connected: false,
      pending: false,
      stale: true,
      primary: { kind: "link", label: "חיבור מחדש", href: "/app/bot/whatsapp-business", emphasis: "quiet" },
    };
  }
  if (bot.whatsappCloud) {
    const digits = bot.whatsappCloud.displayPhoneNumber?.replace(/\D/g, "") ?? "";
    return {
      status: health ?? { tone: "ok", label: "מחובר" },
      connected: true,
      pending: false,
      stale: false,
      primary: digits
        ? { kind: "link", label: "פתיחה ב-WhatsApp", icon: <WhatsAppMark />, href: `https://wa.me/${digits}`, external: true, emphasis: "quiet" }
        : null,
    };
  }
  return {
    status: { tone: "info", label: "לא מחובר" },
    connected: false,
    pending: false,
    stale: false,
    primary: { kind: "link", label: "חיבור", href: "/app/bot/whatsapp-business", emphasis: "quiet" },
  };
}

export function telegramRow(bot: BotSnapshot, health: RowStatus | null): RowModel {
  if (bot.telegram?.linked && bot.telegram.botUsername) {
    return {
      status: health ?? { tone: "ok", label: "מחובר" },
      connected: true,
      pending: false,
      stale: false,
      primary: {
        kind: "link",
        label: "פתיחה בטלגרם",
        icon: <TelegramMark />,
        href: `https://t.me/${bot.telegram.botUsername}`,
        external: true,
        emphasis: "quiet",
      },
    };
  }
  if (bot.telegram && !bot.telegram.linked) {
    return {
      status: { tone: "warn", label: "ממתין לחיבור", pulse: true },
      connected: false,
      pending: true,
      stale: false,
      primary: { kind: "link", label: "המשך חיבור", href: "/app/bot/telegram", emphasis: "quiet" },
    };
  }
  return {
    status: { tone: "info", label: "לא מחובר" },
    connected: false,
    pending: false,
    stale: false,
    primary: { kind: "link", label: "חיבור", href: "/app/bot/telegram", emphasis: "quiet" },
  };
}

interface Fact {
  icon: ReactNode;
  label: string;
  value: string;
  ltr?: boolean;
  missing?: boolean;
  copy?: string;
  onEdit?: () => void;
}

interface ChannelEntry {
  key: Channel;
  name: string;
  shortName: string;
  glyph: ReactNode;
  model: RowModel;
  attention: boolean;
  facts: Fact[];
  note: string | null;
  actions: Action[];
  offer: string;
  connect: Action;
  fastest?: boolean;
}

interface ChannelsProps {
  bot: BotSnapshot;
  cancelPending: Channel | null;
  busy: boolean;
  onDisconnect: (channel: Channel) => void;
  onCancelPending: (channel: Channel) => void;
  onOpenAccess: () => void;
  onEditOwner: (target: OwnerNumberTarget) => void;
  onConnectWhatsapp: () => void;
}

function isActive(entry: ChannelEntry): boolean {
  return entry.model.connected || entry.model.pending || entry.model.stale;
}

function channelEntries({ bot, cancelPending, busy, onDisconnect, onCancelPending, onOpenAccess, onEditOwner, onConnectWhatsapp }: ChannelsProps): ChannelEntry[] {
  const health = channelHealth(bot);
  const whatsapp = whatsappRow(bot, health);
  const telegram = telegramRow(bot, health);
  const business = whatsappCloudRow(bot, health);
  // Emphasis is earned: one filled button, and only while no channel can answer yet.
  const needsChannel = !whatsapp.connected && !telegram.connected && !business.connected;
  const cancelling = cancelPending !== null || busy;
  const entries: ChannelEntry[] = [];

  // Accounts on the official WhatsApp Business path get no QR linking unless a bot already has it.
  if (!bot.whatsappCloudEnabled || bot.hasWhatsappChannel) {
    const missingOwner = whatsapp.connected && ownerNumberMissing(bot);
    const actions: Action[] = [];
    if (missingOwner) actions.push({ kind: "button", label: "הגדרת המספר שלי", emphasis: "primary", onClick: () => onEditOwner("whatsapp") });
    const primary = lead(whatsapp.primary, needsChannel);
    if (primary) actions.push(primary);
    const facts: Fact[] = [];
    if (whatsapp.connected && bot.whatsappAccountId) {
      facts.push({ icon: <PhoneIcon />, label: "מספר הסוכן", value: formatPhoneForDisplay(bot.whatsappAccountId), ltr: true, copy: `+${bot.whatsappAccountId}` });
    }
    if (whatsapp.connected && bot.whatsappAccess) {
      facts.push({
        icon: <PeopleIcon />,
        label: "מי יכול לכתוב",
        value: bot.whatsappAccess.access === "owner" ? "רק אתם" : "כולם",
        onEdit: onOpenAccess,
      });
    }
    if (bot.hasWhatsappChannel && (whatsapp.connected || whatsapp.stale)) {
      const own = bot.owner.whatsappNumber;
      facts.push({
        icon: <PersonIcon />,
        label: "המספר שלכם",
        value: own ? formatPhoneForDisplay(own) : "לא הוגדר",
        ltr: own !== null,
        missing: own === null,
        onEdit: missingOwner ? undefined : () => onEditOwner("whatsapp"),
      });
    }
    if (whatsapp.pending) {
      actions.push({
        kind: "button",
        label: cancelPending === "whatsapp" ? "מבטל…" : "ביטול ההתאמה",
        emphasis: "plain",
        disabled: cancelling,
        onClick: () => onCancelPending("whatsapp"),
      });
    } else if (whatsapp.connected || whatsapp.stale) {
      actions.push({ kind: "button", label: "ניתוק", emphasis: "danger", onClick: () => onDisconnect("whatsapp") });
    }
    entries.push({
      key: "whatsapp",
      name: "WhatsApp",
      shortName: "WhatsApp",
      glyph: <WhatsAppMark />,
      model: missingOwner && !health ? { ...whatsapp, status: { tone: "warn", label: "חסר המספר שלכם" } } : whatsapp,
      attention: whatsapp.pending || whatsapp.stale || missingOwner,
      facts,
      note: missingOwner ? "הגדירו את המספר האישי שממנו אתם כותבים, כדי שהסוכן יזהה אתכם." : null,
      actions,
      offer: "צריך מספר טלפון נפרד לסוכן",
      connect: { kind: "button", label: "חיבור WhatsApp", emphasis: "quiet", onClick: onConnectWhatsapp },
    });
  }

  const telegramActions: Action[] = [];
  const telegramPrimary = lead(telegram.primary, needsChannel);
  if (telegramPrimary && (telegram.connected || telegram.pending)) telegramActions.push(telegramPrimary);
  if (telegram.pending) {
    telegramActions.push({
      kind: "button",
      label: cancelPending === "telegram" ? "מבטל…" : "ביטול החיבור",
      emphasis: "plain",
      disabled: cancelling,
      onClick: () => onCancelPending("telegram"),
    });
  } else if (telegram.connected) {
    telegramActions.push({ kind: "button", label: "ניתוק", emphasis: "danger", onClick: () => onDisconnect("telegram") });
  }
  entries.push({
    key: "telegram",
    name: "Telegram",
    shortName: "Telegram",
    glyph: <TelegramMark />,
    model: telegram,
    attention: telegram.pending,
    facts:
      telegram.connected && bot.telegram?.botUsername
        ? [{ icon: <AtIcon />, label: "שם הבוט", value: `@${bot.telegram.botUsername}`, ltr: true, copy: `@${bot.telegram.botUsername}` }]
        : [],
    note: null,
    actions: telegramActions,
    offer: "בוט טלגרם משלכם, בשתי לחיצות",
    connect: { kind: "link", label: "חיבור Telegram", href: "/app/bot/telegram", emphasis: "quiet" },
    fastest: true,
  });

  if (bot.whatsappCloudEnabled || bot.whatsappCloud) {
    const businessActions: Action[] = [];
    const businessOwner = bot.owner.businessNumber;
    const missingBusinessOwner = business.connected && businessOwner === null;
    if (missingBusinessOwner) {
      businessActions.push({ kind: "button", label: "הגדרת המספר שלי", emphasis: "quiet", onClick: () => onEditOwner("business") });
    }
    if (business.primary && (business.connected || business.stale)) businessActions.push(business.primary);
    if (business.connected) businessActions.push({ kind: "button", label: "ניתוק", emphasis: "danger", onClick: () => onDisconnect("whatsapp-cloud") });
    entries.push({
      key: "whatsapp-cloud",
      name: "WhatsApp Business",
      shortName: "Business",
      glyph: <WhatsAppMark business />,
      model: business,
      attention: business.stale,
      facts: bot.whatsappCloud
        ? [
            ...(bot.whatsappCloud.displayPhoneNumber
              ? [{ icon: <PhoneIcon />, label: "המספר העסקי", value: formatPhoneForDisplay(bot.whatsappCloud.displayPhoneNumber), ltr: true, copy: bot.whatsappCloud.displayPhoneNumber }]
              : []),
            ...(bot.whatsappCloud.verifiedName ? [{ icon: <StoreIcon />, label: "שם העסק", value: bot.whatsappCloud.verifiedName }] : []),
            ...(business.connected
              ? [
                  {
                    icon: <PersonIcon />,
                    label: "המספר שלכם",
                    value: businessOwner ? formatPhoneForDisplay(businessOwner) : "לא הוגדר",
                    ltr: businessOwner !== null,
                    missing: businessOwner === null,
                    onEdit: missingBusinessOwner ? undefined : () => onEditOwner("business"),
                  },
                ]
              : []),
          ]
        : [],
      note: missingBusinessOwner ? "הגדירו את המספר האישי שלכם, כדי שכשתכתבו למספר העסקי הסוכן יזהה אתכם ולא יתייחס אליכם כלקוח." : null,
      actions: businessActions,
      offer: "מספר עסקי ללקוחות שלכם, דרך מטא",
      connect: { kind: "link", label: "חיבור WhatsApp Business", href: "/app/bot/whatsapp-business", emphasis: "quiet" },
    });
  }
  return entries;
}

export function ChannelsSection(props: ChannelsProps) {
  const entries = channelEntries(props);
  const active = entries.filter(isActive);
  const available = entries.filter((entry) => !isActive(entry));
  if (active.length === 0) return <ChannelChoice name={props.bot.displayName} entries={available} />;
  const firstReply = active.some((entry) => entry.model.connected) && props.bot.lastSeenAt === null;
  return <ChannelStrip key={active.map((entry) => entry.key).join()} active={active} available={available} firstReply={firstReply} />;
}

function ChannelChoice({ name, entries }: { name: string; entries: readonly ChannelEntry[] }) {
  const titleId = useId();
  const ordered = [...entries].sort((a, b) => Number(Boolean(b.fastest)) - Number(Boolean(a.fastest)));
  return (
    <section className="mb-6 sm:mb-7" aria-labelledby={titleId}>
      <h3 id={titleId} className="text-base font-semibold text-espresso">
        איפה תרצו לדבר עם {name}?
      </h3>
      <p className="mt-0.5 text-sm text-espresso-light">החיבור לוקח פחות מדקה.</p>
      <ul className={`mt-3 grid gap-2.5 ${ordered.length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {ordered.map((entry) => (
          <li key={entry.key}>
            <OfferTile entry={entry} featured={Boolean(entry.fastest)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function OfferTile({ entry, featured = false }: { entry: ChannelEntry; featured?: boolean }) {
  return <ChannelOfferTile glyph={entry.glyph} name={entry.name} offer={entry.offer} featured={featured} target={entry.connect} />;
}

type Selection = Channel | "add";

function ChannelStrip({ active, available, firstReply }: { active: readonly ChannelEntry[]; available: readonly ChannelEntry[]; firstReply: boolean }) {
  const panelId = useId();
  const [selected, setSelected] = useState<Selection | null>(() => active.find((entry) => entry.attention)?.key ?? null);
  const [shown, setShown] = useState<Selection | null>(selected);
  const open = selected !== null;

  const toggle = (key: Selection) => {
    const next = selected === key ? null : key;
    setSelected(next);
    if (next) setShown(next);
  };

  const shownEntry = shown === "add" ? null : active.find((entry) => entry.key === shown) ?? null;

  return (
    <section className="mb-6 sm:mb-7" aria-label="ערוצים">
      <ul className="-m-1 flex gap-2 overflow-x-auto p-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
        {active.map((entry) => (
          <li key={entry.key} className="shrink-0">
            <button
              type="button"
              aria-expanded={selected === entry.key}
              aria-controls={panelId}
              onClick={() => toggle(entry.key)}
              className={`${CHIP_CLASS} ${selected === entry.key ? CHIP_SELECTED : CHIP_IDLE}`}
            >
              <span aria-hidden>{entry.glyph}</span>
              <span className="font-medium text-espresso sm:hidden">{entry.shortName}</span>
              <span className="hidden font-medium text-espresso sm:inline">{entry.name}</span>
              <ChipStatus status={entry.model.status} />
              <span className="hidden sm:block">
                <ChevronDown open={selected === entry.key} />
              </span>
            </button>
          </li>
        ))}
        {available.length > 0 ? (
          <li className="shrink-0">
            <button
              type="button"
              aria-expanded={selected === "add"}
              aria-controls={panelId}
              aria-label="ערוץ נוסף"
              onClick={() => toggle("add")}
              className={`${CHIP_CLASS} min-w-11 justify-center border-dashed ${selected === "add" ? "border-espresso bg-white" : "border-sand bg-transparent hover:bg-white"}`}
            >
              <PlusIcon />
              <span className="hidden font-medium text-espresso sm:inline">ערוץ נוסף</span>
            </button>
          </li>
        ) : null}
      </ul>

      <div id={panelId} className="disclosure" data-open={open || undefined}>
        <div inert={!open} className="-mx-1 px-1 pb-1">
          <div className="pt-3">
            {shown === "add" ? (
              <ul className={`grid gap-2 ${available.length > 1 ? "sm:grid-cols-2" : ""}`}>
                {available.map((entry) => (
                  <li key={entry.key}>
                    <OfferTile entry={entry} />
                  </li>
                ))}
              </ul>
            ) : shownEntry ? (
              <ChannelPanel entry={shownEntry} />
            ) : null}
          </div>
        </div>
      </div>

      {firstReply ? (
        <p className="mt-3 max-w-md text-xs leading-relaxed text-espresso-light">
          התשובה להודעה הראשונה עשויה לקחת כ-40 שניות, כי הסוכן עולה ברגעים אלו. אחר כך הוא עונה מיד.
        </p>
      ) : null}
    </section>
  );
}

const CHIP_CLASS =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra sm:gap-2 sm:px-3.5";
const CHIP_SELECTED = "border-espresso bg-white shadow-[0_1px_0_rgba(44,24,16,0.06)]";
const CHIP_IDLE = "border-sand-light bg-white hover:border-sand";

function ChannelPanel({ entry }: { entry: ChannelEntry }) {
  const main = entry.actions.filter((action) => action.emphasis === "primary" || action.emphasis === "quiet");
  const exits = entry.actions.filter((action) => action.emphasis === "plain" || action.emphasis === "danger");
  const status = entry.model.status;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-sand-light p-3 sm:p-4">
      {entry.note ? (
        <p className="px-1 text-sm leading-relaxed text-espresso">{entry.note}</p>
      ) : status.tone !== "ok" ? (
        <p className={`px-1 text-sm font-medium sm:hidden ${STATUS_COLOR[status.tone]}`}>{status.label}</p>
      ) : null}
      {entry.facts.length > 1 ? (
        <ul className={`grid gap-2 ${entry.facts.length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          {entry.facts.map((fact) => (
            <li key={fact.label}>
              <FactTile fact={fact} />
            </li>
          ))}
        </ul>
      ) : entry.facts.length === 1 ? (
        <FactLine fact={entry.facts[0]} />
      ) : null}
      {entry.actions.length > 0 ? (
        <div className={`flex flex-wrap items-center justify-between gap-2 ${entry.facts.length > 1 || entry.note ? "border-t border-sand-light/70 pt-3" : ""}`}>
          <div className="flex flex-wrap items-center gap-2">
            {main.map((action) => (
              <PanelAction key={action.label} action={action} />
            ))}
          </div>
          {exits.length > 0 ? (
            <div className="-mx-1 flex items-center">
              {exits.map((action) => (
                <PanelAction key={action.label} action={action} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const FACT_TILE =
  "flex h-full min-h-[4.25rem] w-full flex-col justify-center gap-1 rounded-xl bg-cream px-3.5 py-2.5 text-start";

function useCopy(text: string | undefined): { copied: boolean; copy: (() => Promise<void>) | null } {
  const [copied, setCopied] = useState(false);
  if (!text) return { copied, copy: null };
  return {
    copied,
    copy: async () => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } catch {
        // Clipboard blocked (insecure context); the value stays visible to copy by hand.
      }
    },
  };
}

// The whole tile is the action, so copying or changing a value never means hunting for a link at the far edge.
function FactTile({ fact }: { fact: Fact }) {
  const { copied, copy } = useCopy(fact.copy);
  const run = copy ?? fact.onEdit;
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-xs text-espresso-light">
        <span aria-hidden>{fact.icon}</span>
        <span className={`min-w-0 flex-1 truncate ${copied ? "font-medium text-sage-dark" : ""}`}>{copied ? "הועתק" : fact.label}</span>
        {run ? (
          <span aria-hidden className={copied ? "text-sage-dark" : "transition group-hover:text-espresso"}>
            {copied ? <CheckIcon /> : copy ? <CopyIcon /> : <PencilIcon />}
          </span>
        ) : null}
      </span>
      <span className={`truncate text-[15px] font-medium ${fact.missing ? "text-terra-dark" : "text-espresso"}`}>
        {fact.ltr ? <bdi dir="ltr">{fact.value}</bdi> : fact.value}
      </span>
    </>
  );
  if (!run) return <div className={FACT_TILE}>{body}</div>;
  return (
    <button
      type="button"
      onClick={run}
      aria-label={`${fact.label}: ${fact.value}. ${copy ? "העתקה" : "שינוי"}`}
      className={`group ${FACT_TILE} transition hover:bg-cream-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-terra`}
    >
      {body}
      <span className="sr-only" aria-live="polite">
        {copied ? "הועתק" : ""}
      </span>
    </button>
  );
}

// A lone detail reads as a quiet line above the actions; a grid of one tile would leave half the row empty.
function FactLine({ fact }: { fact: Fact }) {
  const { copied, copy } = useCopy(fact.copy);
  const run = copy ?? fact.onEdit;
  return (
    <p className="flex min-w-0 items-center gap-1 px-1 text-sm text-espresso-light">
      <span className="sr-only">{fact.label}: </span>
      <span className="truncate">{fact.ltr ? <bdi dir="ltr">{fact.value}</bdi> : fact.value}</span>
      {run ? (
        <button
          type="button"
          onClick={run}
          aria-label={copy ? (copied ? "הועתק" : `העתקת ${fact.label}`) : `שינוי ${fact.label}`}
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition hover:bg-cream-dark hover:text-espresso focus:outline-none focus-visible:ring-2 focus-visible:ring-terra ${copied ? "text-sage-dark" : ""}`}
        >
          {copied ? <CheckIcon /> : copy ? <CopyIcon /> : <PencilIcon />}
        </button>
      ) : null}
    </p>
  );
}

const TEXT_ACTION = "inline-flex min-h-11 items-center px-2 text-sm font-medium underline-offset-4 transition hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-terra rounded-lg disabled:opacity-60";

function actionClass(emphasis: Emphasis): string {
  switch (emphasis) {
    case "primary":
    case "quiet":
      return ROW_ACTION_CLASS[emphasis];
    case "plain":
      return `${TEXT_ACTION} text-espresso-light hover:text-espresso`;
    case "danger":
      return `${TEXT_ACTION} text-espresso-light hover:text-red-700`;
  }
}

function PanelAction({ action }: { action: Action }) {
  const className = actionClass(action.emphasis);
  if (action.kind === "button") {
    return (
      <button type="button" onClick={action.onClick} disabled={action.disabled} className={className}>
        {action.label}
      </button>
    );
  }
  if (action.external) {
    return (
      <a href={action.href} target="_blank" rel="noopener noreferrer" className={className}>
        {action.icon ? <span aria-hidden>{action.icon}</span> : null}
        <span>{action.label}</span>
        {action.icon ? null : <ArrowOut />}
      </a>
    );
  }
  return (
    <PendingLink href={action.href} className={className}>
      <span>{action.label}</span>
      <ChevronEnd />
    </PendingLink>
  );
}

const STATUS_COLOR: Record<RowStatus["tone"], string> = {
  ok: "text-sage-dark",
  warn: "text-terra",
  err: "text-red-700",
  info: "text-espresso-light",
};

// On a phone the chip keeps only the dot; the words move into the opened panel.
function ChipStatus({ status }: { status: RowStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${STATUS_COLOR[status.tone]}`}>
      <span aria-hidden className="relative flex h-2 w-2">
        {status.pulse ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" /> : null}
        <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
      </span>
      <span className={status.tone === "ok" ? "sr-only" : "sr-only sm:not-sr-only"}>{status.label}</span>
    </span>
  );
}


function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-4 w-4 text-espresso-light transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 text-espresso-light" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

function ArrowOut() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M7 13 13 7M8 7h5v5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICON_PROPS = {
  "aria-hidden": true,
  viewBox: "0 0 20 20",
  className: "h-4 w-4",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function PhoneIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M5.2 3h2.3l1.4 3.6-1.8 1.1a9.5 9.5 0 0 0 5.2 5.2l1.1-1.8 3.6 1.4v2.3a1.9 1.9 0 0 1-2 1.9A13.2 13.2 0 0 1 3.3 5a1.9 1.9 0 0 1 1.9-2z" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="7.5" cy="7" r="2.75" />
      <path d="M2.5 16c.5-2.6 2.6-4 5-4s4.5 1.4 5 4M13 4.4a2.6 2.6 0 0 1 0 5.2M14.6 12.1c1.5.5 2.5 1.8 2.9 3.9" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="10" cy="7" r="3" />
      <path d="M4 17c.6-3 3-4.75 6-4.75S15.4 14 16 17" />
    </svg>
  );
}

function AtIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="10" cy="10" r="3" />
      <path d="M13 10v1.3a2.4 2.4 0 0 0 4.8 0V10a7.8 7.8 0 1 0-3 6.2" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 8l1.4-4h11.2L17 8M3 8h14M4 8v8h12V8M8.5 16v-4h3v4" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="6.5" y="6.5" width="9.5" height="9.5" rx="1.5" />
      <path d="M4 13.5V5a1 1 0 0 1 1-1h8.5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12.8 4.2l3 3L7.3 15.7H4.3v-3z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...ICON_PROPS} strokeWidth={2}>
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </svg>
  );
}
