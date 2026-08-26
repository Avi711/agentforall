"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/app/app/ConfirmDialog";
import { FEATURED_APPS, featuredApp } from "@/lib/integrations/catalog.he";
import { CONNECTIONS_PATH } from "@/lib/integrations/paths";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";
import type { CatalogApp, IntegrationConnection } from "@/lib/orchestrator/types";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 90_000;
const OTHERS_PREVIEW = 24;

export type PanelData =
  | { available: true; catalog: CatalogApp[]; connections: IntegrationConnection[] }
  | { available: false };

type Toast = { tone: "ok" | "warn"; text: string } | null;

export function ConnectionsPanel({
  botId,
  initial,
  connectedApp,
}: {
  botId: string;
  initial: PanelData;
  connectedApp: string | null;
}) {
  if (!initial.available) return <Unavailable />;
  return <Panel botId={botId} catalog={initial.catalog} initialConnections={initial.connections} connectedApp={connectedApp} />;
}

function Panel({
  botId,
  catalog,
  initialConnections,
  connectedApp,
}: {
  botId: string;
  catalog: CatalogApp[];
  initialConnections: IntegrationConnection[];
  connectedApp: string | null;
}) {
  const [connections, setConnections] = useState(initialConnections);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [query, setQuery] = useState("");
  const [disconnecting, setDisconnecting] = useState<IntegrationConnection | null>(null);

  const bySlug = useMemo(() => new Map(catalog.map((app) => [app.slug, app])), [catalog]);
  const featured = useMemo(
    () => FEATURED_APPS.map((f) => bySlug.get(f.slug)).filter((app): app is CatalogApp => Boolean(app)),
    [bySlug],
  );
  const others = useMemo(() => {
    const featuredSlugs = new Set(FEATURED_APPS.map((f) => f.slug));
    const rest = catalog.filter((app) => !featuredSlugs.has(app.slug) && !app.noAuth);
    const q = query.trim().toLowerCase();
    if (!q) return rest.slice(0, OTHERS_PREVIEW);
    return rest.filter((app) => app.name.toLowerCase().includes(q) || app.slug.includes(q));
  }, [catalog, query]);

  // After the OAuth round trip the provider may still be finalizing; poll until the app is live.
  useEffect(() => {
    if (!connectedApp) return;
    window.history.replaceState(window.history.state, "", CONNECTIONS_PATH);
    let cancelled = false;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const label = appLabel(connectedApp, bySlug.get(connectedApp));

    const tick = async () => {
      try {
        const res = await fetch(`/api/bot/${botId}/integrations`, { cache: "no-store" });
        const data: unknown = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.ok && isListResponse(data)) {
          setConnections(data.data);
          if (data.data.some((c) => c.app === connectedApp && c.status === "active")) {
            setToast({ tone: "ok", text: `✓ ${label} חובר בהצלחה` });
            return;
          }
        }
      } catch {
        // transient — keep polling until the deadline
      }
      if (Date.now() < deadline) {
        setTimeout(tick, POLL_INTERVAL_MS);
      } else {
        setToast({ tone: "warn", text: `לא הצלחנו לאמת את החיבור ל-${label}. נסו להתחבר שוב.` });
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [botId, connectedApp, bySlug]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  async function connect(app: CatalogApp) {
    setError(null);
    setBusySlug(app.slug);
    try {
      const res = await fetch(`/api/bot/${botId}/integrations/${encodeURIComponent(app.slug)}/connect`, {
        method: "POST",
        cache: "no-store",
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok || !isLinkResponse(data)) {
        setError(UNEXPECTED_ERROR_HE);
        setBusySlug(null);
        return;
      }
      window.location.assign(data.url);
    } catch {
      setError(UNEXPECTED_ERROR_HE);
      setBusySlug(null);
    }
  }

  async function disconnect(connection: IntegrationConnection) {
    const res = await fetch(`/api/bot/${botId}/integrations/${encodeURIComponent(connection.ref)}`, {
      method: "DELETE",
      cache: "no-store",
    });
    if (!res.ok) throw new Error(UNEXPECTED_ERROR_HE);
    setConnections((current) => current.filter((c) => c.ref !== connection.ref));
    setToast({ tone: "ok", text: `${appLabel(connection.app, bySlug.get(connection.app))} נותק` });
  }

  // Reconnecting creates a new account beside a stale one; the live one is what the tile reflects.
  const connectionOf = (slug: string) => {
    const mine = connections.filter((c) => c.app === slug);
    return mine.find((c) => c.status === "active") ?? mine.find((c) => c.status === "pending") ?? mine[0] ?? null;
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-sand-light p-5 sm:p-8">
      {toast ? <ToastBanner toast={toast} /> : null}
      <p className="text-xs uppercase tracking-[0.22em] text-terra mb-3">חיבורים</p>
      <h2 className="font-display text-xl sm:text-2xl text-espresso mb-3">האפליקציות של הבוט שלכם</h2>
      <p className="text-sm text-espresso-light leading-relaxed mb-6 max-w-lg">
        חברו אפליקציה בלחיצה אחת — נעביר אתכם למסך האישור של השירות, ואחרי האישור הבוט יוכל להשתמש
        בה מתוך WhatsApp או Telegram. אפשר לנתק בכל רגע.
      </p>

      {error ? (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-6">{error}</p>
      ) : null}

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
        {featured.map((app) => (
          <AppTile
            key={app.slug}
            app={app}
            connection={connectionOf(app.slug)}
            busy={busySlug === app.slug}
            onConnect={() => connect(app)}
            onDisconnect={(c) => setDisconnecting(c)}
          />
        ))}
      </ul>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <h3 className="font-display text-lg text-espresso">עוד אפליקציות</h3>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש לפי שם…"
          aria-label="חיפוש אפליקציה"
          className="sm:ms-auto w-full sm:w-64 px-4 py-2 rounded-xl border border-sand-light bg-cream text-sm text-espresso focus:outline-none focus-visible:ring-2 focus-visible:ring-terra"
        />
      </div>
      {others.length === 0 ? (
        <p className="text-sm text-espresso-light">לא נמצאו אפליקציות מתאימות.</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {others.map((app) => (
            <AppTile
              key={app.slug}
              app={app}
              connection={connectionOf(app.slug)}
              busy={busySlug === app.slug}
              onConnect={() => connect(app)}
              onDisconnect={(c) => setDisconnecting(c)}
            />
          ))}
        </ul>
      )}

      <p className="mt-8 text-sm text-espresso-light">
        <Link href="/app" className="text-terra underline">
          לעמוד הבית
        </Link>
      </p>

      <ConfirmDialog
        open={disconnecting !== null}
        title="לנתק את האפליקציה?"
        description="הבוט לא יוכל יותר להשתמש בה, וההרשאה שנתתם תבוטל אצל השירות."
        confirmLabel="ניתוק"
        busyLabel="מנתק…"
        onClose={() => setDisconnecting(null)}
        onConfirm={async () => {
          if (disconnecting) await disconnect(disconnecting);
          setDisconnecting(null);
        }}
      />
    </div>
  );
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
  const blurb = featuredApp(app.slug)?.blurbHe ?? app.description ?? "";
  const status = connectionStatus(connection);

  return (
    <li className="flex items-center gap-3 rounded-xl border border-sand-light bg-cream/40 px-4 py-3">
      <span aria-hidden className="shrink-0 w-10 h-10 rounded-full bg-white border border-sand-light flex items-center justify-center overflow-hidden">
        {app.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={app.logo} alt="" className="w-6 h-6 object-contain" />
        ) : (
          <span className="text-espresso-light text-sm font-medium">{label.slice(0, 1)}</span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[15px] font-medium text-espresso">{label}</span>
          {status ? (
            <span className={`text-xs px-2 py-0.5 rounded-full ${status.className}`}>{status.label}</span>
          ) : null}
        </div>
        {blurb ? <p className="text-xs text-espresso-light truncate">{blurb}</p> : null}
      </div>
      {connection?.status === "active" ? (
        <button
          type="button"
          onClick={() => onDisconnect(connection)}
          className="shrink-0 text-sm text-espresso-light hover:text-espresso underline-offset-2 hover:underline"
        >
          ניתוק
        </button>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          disabled={busy}
          className="shrink-0 px-4 py-2 rounded-xl bg-terra text-white text-sm font-medium hover:bg-terra-light transition disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 focus-visible:ring-offset-white"
        >
          {busy ? "מעביר…" : connection ? "חיבור מחדש" : "התחבר"}
        </button>
      )}
    </li>
  );
}

function connectionStatus(connection: IntegrationConnection | null): { label: string; className: string } | null {
  if (!connection) return null;
  switch (connection.status) {
    case "active":
      return { label: "מחובר", className: "bg-sage/15 text-sage-dark" };
    case "pending":
      return { label: "ממתין לאישור", className: "bg-terra-pale text-terra" };
    default:
      return { label: "נדרש חיבור מחדש", className: "bg-red-50 text-red-700" };
  }
}

function ToastBanner({ toast }: { toast: NonNullable<Toast> }) {
  const tone = toast.tone === "ok" ? "bg-sage text-white" : "bg-terra text-white";
  return (
    <div className="fixed top-20 inset-x-0 flex justify-center px-4 z-50 pointer-events-none" role="status">
      <div className={`max-w-full ${tone} text-sm sm:text-base px-5 py-3 rounded-xl shadow-lg font-medium text-center pointer-events-auto`}>
        {toast.text}
      </div>
    </div>
  );
}

function Unavailable() {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-sand-light p-5 sm:p-8 max-w-2xl">
      <p className="text-xs uppercase tracking-[0.22em] text-terra mb-3">חיבורים</p>
      <h2 className="font-display text-xl sm:text-2xl text-espresso mb-3">עוד לא זמין</h2>
      <p className="text-sm text-espresso-light leading-relaxed">
        חיבור אפליקציות עדיין לא פעיל בחשבון הזה.{" "}
        <Link href="/app" className="text-terra underline">
          לעמוד הבית
        </Link>
      </p>
    </div>
  );
}

function appLabel(slug: string, app: CatalogApp | undefined): string {
  return featuredApp(slug)?.nameHe ?? app?.name ?? slug;
}

function isListResponse(data: unknown): data is { data: IntegrationConnection[] } {
  return typeof data === "object" && data !== null && Array.isArray((data as { data?: unknown }).data);
}

function isLinkResponse(data: unknown): data is { url: string } {
  return typeof data === "object" && data !== null && typeof (data as { url?: unknown }).url === "string";
}
