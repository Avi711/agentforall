"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/app/app/ConfirmDialog";
import { BotAvatar, SECTION_LABEL } from "@/app/app/Marks";
import { Toast, type ToastTone } from "@/app/app/Toast";
import { featuredApp } from "@/lib/integrations/catalog.he";
import { connectionFor, tileStatus, type TileTone } from "@/lib/integrations/connections";
import { CONNECTIONS_PATH } from "@/lib/integrations/paths";
import { CATALOG_QUERY_MAX_LENGTH } from "@/lib/integrations/schemas";
import type { ConnectionsOverview } from "@/lib/integrations/service";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";
import {
  CatalogResponseSchema,
  ConnectLinkSchema,
  type CatalogApp,
  type IntegrationConnection,
} from "@/lib/orchestrator/types";
import { useLiveConnections, type WatchOutcome } from "./useLiveConnections";

const SEARCH_DEBOUNCE_MS = 250;

export type PanelData = ({ available: true } & ConnectionsOverview) | { available: false };

type ToastMessage = { tone: ToastTone; text: string } | null;

export function ConnectionsPanel({
  botId,
  botName,
  initial,
  connectedApp,
}: {
  botId: string;
  botName: string;
  initial: PanelData;
  connectedApp: string | null;
}) {
  if (!initial.available) return <Unavailable />;
  return <Panel botId={botId} botName={botName} overview={initial} connectedApp={connectedApp} />;
}

function Panel({
  botId,
  botName,
  overview,
  connectedApp,
}: {
  botId: string;
  botName: string;
  overview: ConnectionsOverview;
  connectedApp: string | null;
}) {
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage>(null);
  const [disconnecting, setDisconnecting] = useState<{ connection: IntegrationConnection; app: CatalogApp } | null>(null);

  const onWatch = useCallback(
    (outcome: WatchOutcome) => {
      if (!connectedApp) return;
      const label = appLabel(connectedApp, overview.watched);
      setToast(
        outcome === "active"
          ? { tone: "ok", text: `${label} חובר בהצלחה` }
          : { tone: "warn", text: `לא הצלחנו לאמת את החיבור ל־${label}. נסו להתחבר שוב.` },
      );
    },
    [connectedApp, overview.watched],
  );
  const { connections, setConnections } = useLiveConnections(botId, overview.connections, connectedApp, onWatch);

  useEffect(() => {
    if (connectedApp) window.history.replaceState(window.history.state, "", CONNECTIONS_PATH);
  }, [connectedApp]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const { query, setQuery, results, searching, failed } = useCatalogSearch();
  const others = results ?? overview.popular;
  const activeCount = connections.filter((c) => c.status === "active").length;

  async function connect(app: CatalogApp) {
    setError(null);
    setBusySlug(app.slug);
    try {
      const res = await fetch(`/api/bot/${botId}/integrations/${encodeURIComponent(app.slug)}/connect`, {
        method: "POST",
        cache: "no-store",
      });
      const parsed = ConnectLinkSchema.safeParse(await res.json().catch(() => null));
      if (!res.ok || !parsed.success) {
        setError(UNEXPECTED_ERROR_HE);
        setBusySlug(null);
        return;
      }
      window.location.assign(parsed.data.url);
    } catch {
      setError(UNEXPECTED_ERROR_HE);
      setBusySlug(null);
    }
  }

  async function disconnect(connection: IntegrationConnection, app: CatalogApp) {
    const res = await fetch(`/api/bot/${botId}/integrations/${encodeURIComponent(connection.ref)}`, {
      method: "DELETE",
      cache: "no-store",
    });
    if (!res.ok) throw new Error(UNEXPECTED_ERROR_HE);
    setConnections((current) => current.filter((c) => c.ref !== connection.ref));
    setToast({ tone: "ok", text: `${appLabel(app.slug, app)} נותק` });
  }

  const tile = (app: CatalogApp) => (
    <AppTile
      key={app.slug}
      app={app}
      connection={connectionFor(connections, app.slug)}
      busy={busySlug === app.slug}
      onConnect={() => connect(app)}
      onDisconnect={(connection) => setDisconnecting({ connection, app })}
    />
  );

  const disconnectingLabel = disconnecting ? appLabel(disconnecting.app.slug, disconnecting.app) : "";

  return (
    <div className="bg-white rounded-[28px] border border-sand-light shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] p-5 sm:p-10">
      <Toast tone={toast?.tone ?? "ok"} text={toast?.text ?? null} onDismiss={() => setToast(null)} />

      <div className="flex items-start gap-3 sm:gap-5 mb-5">
        <BotAvatar name={botName} tone="warm" size="sm" />
        <div className="min-w-0">
          <p className={`${SECTION_LABEL} mb-1`}>חיבורים לאפליקציות</p>
          <h2 className="font-display text-xl sm:text-2xl text-espresso leading-tight text-balance break-words">
            האפליקציות של {botName}
          </h2>
        </div>
      </div>

      <p className="text-sm text-espresso-light leading-relaxed mb-6 max-w-lg">
        חברו אפליקציה בלחיצה אחת — נעביר אתכם למסך האישור של השירות, ואחרי האישור {botName} יוכל
        להשתמש בה מתוך וואטסאפ או טלגרם. החיבורים כאן שייכים רק ל־{botName}, ואפשר לנתק בכל רגע.
      </p>

      {error ? (
        <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 mb-6">
          {error}
        </p>
      ) : null}

      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="font-display text-lg text-espresso">הכי שימושיות</h3>
        {activeCount > 0 ? (
          <p className="text-xs text-sage-dark font-medium">{activeCount} מחוברות</p>
        ) : null}
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">{overview.featured.map(tile)}</ul>

      <h3 className="font-display text-lg text-espresso mb-1">כל שאר האפליקציות</h3>
      <p className="text-sm text-espresso-light leading-relaxed mb-4 max-w-lg">
        אלפי שירותים נוספים. חפשו לפי שם — התיאורים מגיעים מהשירות עצמו, ולכן הם באנגלית.
      </p>

      <SearchField query={query} onQuery={setQuery} searching={searching} />

      {failed ? (
        <p role="alert" className="text-sm text-red-700 mb-3">
          {UNEXPECTED_ERROR_HE}
        </p>
      ) : null}

      {others.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-sand-light bg-cream/50 px-4 py-8 text-center">
          <p className="text-sm text-espresso" aria-live="polite">
            {searching
              ? "מחפשים…"
              : query.trim()
                ? `לא מצאנו אפליקציה בשם "${query.trim()}".`
                : "אין כרגע אפליקציות נוספות להצגה."}
          </p>
          {!searching && query.trim() ? (
            <p className="mt-1.5 text-xs text-espresso-light">נסו את השם באנגלית, או חלק ממנו.</p>
          ) : null}
        </div>
      ) : (
        <ul className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${searching ? "opacity-60" : ""}`} aria-busy={searching}>
          {others.map(tile)}
        </ul>
      )}

      <p className="mt-10 pt-6 border-t border-sand-light/70">
        <Link
          href="/app"
          className="inline-flex min-h-11 items-center gap-1.5 -ms-2 px-2 rounded-lg text-sm text-terra hover:text-terra-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-terra transition"
        >
          <BackChevron />
          <span>חזרה לבית שלי</span>
        </Link>
      </p>

      <ConfirmDialog
        open={disconnecting !== null}
        title={`לנתק את ${disconnectingLabel}?`}
        description={`${botName} לא יוכל יותר להשתמש ב־${disconnectingLabel}, וההרשאה שנתתם תבוטל אצל השירות. אפשר לחבר מחדש בכל רגע.`}
        confirmLabel="ניתוק"
        busyLabel="מנתקים…"
        onClose={() => setDisconnecting(null)}
        onConfirm={async () => {
          if (disconnecting) await disconnect(disconnecting.connection, disconnecting.app);
          setDisconnecting(null);
        }}
      />
    </div>
  );
}

function SearchField({
  query,
  onQuery,
  searching,
}: {
  query: string;
  onQuery: (value: string) => void;
  searching: boolean;
}) {
  return (
    <div className="relative mb-4">
      <span aria-hidden className="absolute inset-y-0 start-0 ps-3.5 flex items-center text-espresso-light">
        <SearchIcon />
      </span>
      <input
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="חיפוש אפליקציה לפי שם…"
        aria-label="חיפוש אפליקציה לפי שם"
        aria-busy={searching}
        maxLength={CATALOG_QUERY_MAX_LENGTH}
        className="w-full min-h-11 ps-10 pe-4 py-2.5 rounded-xl border border-sand-light bg-cream text-sm text-espresso placeholder:text-espresso-light/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:border-terra transition"
      />
    </div>
  );
}

// Searches the orchestrator's cached catalog instead of shipping ~1,400 apps to the browser.
function useCatalogSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogApp[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setSearching(false);
      setFailed(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/integrations/catalog?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const parsed = CatalogResponseSchema.safeParse(await res.json().catch(() => null));
        if (res.ok && parsed.success) setResults(parsed.data.data);
        setFailed(!(res.ok && parsed.success));
      } catch {
        // Aborted by a newer keystroke, or the network failed: what is on screen stays.
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return { query, setQuery, results, searching, failed };
}

function AppTile({
  app,
  connection,
  busy,
  onConnect,
  onDisconnect,
}: {
  app: CatalogApp;
  connection: IntegrationConnection | null;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: (connection: IntegrationConnection) => void;
}) {
  const label = appLabel(app.slug, app);
  const featured = featuredApp(app.slug);
  const blurb = featured?.blurbHe ?? app.description ?? "";
  // Provider descriptions are English; truncating LTR text inside an RTL box eats its start.
  const english = !featured;
  const status = tileStatus(connection);
  const connected = connection?.status === "active";

  return (
    <li className="flex items-center gap-3 rounded-2xl border border-sand-light bg-cream/40 px-4 py-3 min-h-[4.75rem]">
      <span aria-hidden className="shrink-0 w-10 h-10 rounded-full bg-white border border-sand-light flex items-center justify-center overflow-hidden">
        {app.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={app.logo} alt="" className="w-6 h-6 object-contain" />
        ) : (
          <span className="text-espresso-light text-sm font-medium">{label.slice(0, 1)}</span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[15px] font-medium text-espresso">{label}</span>
          {status ? (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TONE_CLASS[status.tone]}`}>
              {status.label}
            </span>
          ) : null}
        </div>
        {blurb ? (
          <p
            dir={english ? "ltr" : undefined}
            lang={english ? "en" : undefined}
            className="text-xs text-espresso-light truncate text-end"
          >
            {blurb}
          </p>
        ) : null}
      </div>
      {connected && connection ? (
        <button
          type="button"
          onClick={() => onDisconnect(connection)}
          aria-label={`ניתוק ${label}`}
          className="shrink-0 min-h-11 px-4 py-2 rounded-full border border-sand-light text-sm font-medium text-espresso-light hover:text-espresso hover:bg-cream-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 focus-visible:ring-offset-white transition"
        >
          ניתוק
        </button>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          disabled={busy}
          aria-label={`${status?.tone === "error" ? "חיבור מחדש של" : "חיבור"} ${label}`}
          className="shrink-0 min-h-11 px-4 py-2 rounded-full bg-terra text-white text-sm font-medium hover:bg-terra-dark transition disabled:opacity-60 disabled:cursor-wait focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 focus-visible:ring-offset-white"
        >
          {busy ? "מעבירים…" : status?.tone === "error" ? "חיבור מחדש" : "חיבור"}
        </button>
      )}
    </li>
  );
}

const TONE_CLASS: Record<TileTone, string> = {
  ok: "bg-sage-pale text-sage-dark",
  wait: "bg-terra-pale text-terra",
  muted: "bg-sand-light text-espresso-light",
  error: "bg-red-50 text-red-700",
};

function Unavailable() {
  return (
    <div className="bg-white rounded-[28px] border border-sand-light shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] p-5 sm:p-10 max-w-2xl">
      <p className={`${SECTION_LABEL} mb-3`}>חיבורים לאפליקציות</p>
      <h2 className="font-display text-xl sm:text-2xl text-espresso mb-3">עוד לא זמין</h2>
      <p className="text-sm text-espresso-light leading-relaxed mb-5">
        חיבור אפליקציות עדיין לא פעיל בחשבון הזה. נעדכן אתכם ברגע שהוא ייפתח.
      </p>
      <Link
        href="/app"
        className="inline-flex min-h-11 items-center gap-1.5 -ms-2 px-2 rounded-lg text-sm text-terra hover:text-terra-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-terra transition"
      >
        <BackChevron />
        <span>חזרה לבית שלי</span>
      </Link>
    </div>
  );
}

function BackChevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="w-4 h-4 rtl:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M12 5l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13.2 13.2 17 17" strokeLinecap="round" />
    </svg>
  );
}

function appLabel(slug: string, app: CatalogApp | null | undefined): string {
  return featuredApp(slug)?.nameHe ?? app?.name ?? slug;
}
