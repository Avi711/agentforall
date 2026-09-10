"use client";

import { PendingLink } from "@/app/app/Pending";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/app/app/ConfirmDialog";
import { BotAvatar, SECTION_LABEL } from "@/app/app/Marks";
import { Toast, type ToastTone } from "@/app/app/Toast";
import { featuredApp, searchFeatured } from "@/lib/integrations/catalog.he";
import {
  UNNAMED_ACCOUNT_HE,
  accountName,
  accountsFor,
  canAddAccount,
  connectedAtHe,
  isolate,
  labelsTakenForNew,
  labelsTakenForRename,
  tileStatus,
  type TileTone,
} from "@/lib/integrations/connections";
import { integrationErrorHe, integrationErrorKind } from "@/lib/integrations/errors";
import { CONNECTIONS_PATH } from "@/lib/integrations/paths";
import {
  CATALOG_QUERY_MAX_LENGTH,
  CATALOG_SEARCH_LIMIT,
  INTEGRATION_MAX_ACCOUNTS_PER_APP,
} from "@/lib/integrations/schemas";
import type { ConnectionsOverview } from "@/lib/integrations/service";
import { UNEXPECTED_ERROR_HE } from "@/lib/messages.he";
import {
  CatalogResponseSchema,
  ConnectLinkSchema,
  type CatalogApp,
  type CatalogPage,
  type IntegrationConnection,
} from "@/lib/orchestrator/types";
import { AccountNamesDialog, type NameField, type SubmitFailure } from "./AccountNamesDialog";
import { useLiveConnections, type WatchOutcome } from "./useLiveConnections";

const SEARCH_DEBOUNCE_MS = 250;
const NEW_ACCOUNT_FIELD = "new";

export type PanelData = ({ available: true } & ConnectionsOverview) | { available: false };

type ToastMessage = { tone: ToastTone; text: string } | null;

// `accounts` is the app's whole tile; `unnamed` (oldest first, like the rows) get named before a new one is added.
type NamingRequest =
  | { kind: "add"; app: CatalogApp; accounts: IntegrationConnection[]; unnamed: IntegrationConnection[] }
  | { kind: "rename"; app: CatalogApp; account: IntegrationConnection; accounts: IntegrationConnection[] };

interface TileActions {
  connect: (app: CatalogApp) => void;
  addAccount: (app: CatalogApp, accounts: IntegrationConnection[]) => void;
  reconnect: (app: CatalogApp, account: IntegrationConnection) => void;
  rename: (app: CatalogApp, account: IntegrationConnection, accounts: IntegrationConnection[]) => void;
  remove: (app: CatalogApp, account: IntegrationConnection) => void;
  cancelAttempt: (app: CatalogApp, account: IntegrationConnection) => void;
}

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
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage>(null);
  const [removing, setRemoving] = useState<{ connection: IntegrationConnection; app: CatalogApp } | null>(null);
  const [naming, setNaming] = useState<NamingRequest | null>(null);

  const onWatch = useCallback(
    (outcome: WatchOutcome) => {
      if (!connectedApp) return;
      const label = appLabel(connectedApp, overview.watched);
      setToast(
        outcome.kind === "active"
          ? { tone: "ok", text: `${accountName(label, outcome.account)} חובר בהצלחה` }
          : { tone: "warn", text: `לא הצלחנו לאמת את החיבור ל־${label}. נסו להתחבר שוב.` },
      );
    },
    [connectedApp, overview.watched],
  );
  const { connections, setConnections } = useLiveConnections(botId, overview.connections, connectedApp, onWatch);

  useEffect(() => {
    if (connectedApp) window.history.replaceState(window.history.state, "", CONNECTIONS_PATH);
  }, [connectedApp]);

  // Back from the consent page, a browser may restore this page as it was left: mid-redirect.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusyKey(null);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  // One list, composed on the server: connected apps, then the ones we curate, then the catalog.
  const start = useMemo<Listing>(
    () => ({
      apps: dedupe([...overview.mine, ...overview.featured, ...overview.browse.apps]),
      cursor: overview.browse.apps.length,
      total: overview.browse.total,
    }),
    [overview],
  );
  const hoist = useCallback(
    (q: string) => {
      const slugs = new Set(searchFeatured(q));
      return overview.featured.filter((app) => slugs.has(app.slug));
    },
    [overview.featured],
  );
  const catalog = useCatalogListing(start, hoist);
  const searchTerm = catalog.query.trim();
  const tiles = wideTilesFirst(
    catalog.listing.apps.map((app) => ({ app, accounts: accountsFor(connections, app.slug) })),
  );

  // Navigates away on success, so a null answer leaves the caller's busy state standing.
  async function requestConnect(app: CatalogApp, label?: string): Promise<SubmitFailure | null> {
    try {
      const res = await fetch(`/api/bot/${botId}/integrations/${encodeURIComponent(app.slug)}/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(label ? { label } : {}),
        cache: "no-store",
      });
      const body: unknown = await res.json().catch(() => null);
      const parsed = ConnectLinkSchema.safeParse(body);
      if (res.ok && parsed.success) {
        window.location.assign(parsed.data.url);
        return null;
      }
      const kind = integrationErrorKind(body);
      const message = integrationErrorHe(kind, appLabel(app.slug, app));
      return kind === "label_taken" || kind === "invalid_label" ? { field: NEW_ACCOUNT_FIELD, message } : { message };
    } catch {
      return { message: UNEXPECTED_ERROR_HE };
    }
  }

  async function requestRename(app: CatalogApp, account: IntegrationConnection, label: string): Promise<SubmitFailure | null> {
    try {
      const res = await fetch(`/api/bot/${botId}/integrations/${encodeURIComponent(account.ref)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
        cache: "no-store",
      });
      if (!res.ok) {
        const kind = integrationErrorKind(await res.json().catch(() => null));
        return { field: account.ref, message: integrationErrorHe(kind, appLabel(app.slug, app)) };
      }
      setConnections((current) => current.map((c) => (c.ref === account.ref ? { ...c, label } : c)));
      return null;
    } catch {
      return { message: UNEXPECTED_ERROR_HE };
    }
  }

  async function revoke(connection: IntegrationConnection): Promise<void> {
    const res = await fetch(`/api/bot/${botId}/integrations/${encodeURIComponent(connection.ref)}`, {
      method: "DELETE",
      cache: "no-store",
    });
    if (!res.ok) throw new Error(UNEXPECTED_ERROR_HE);
    setConnections((current) => current.filter((c) => c.ref !== connection.ref));
  }

  async function connectFromTile(key: string, app: CatalogApp, label?: string) {
    setError(null);
    setBusyKey(key);
    const failure = await requestConnect(app, label);
    if (failure) {
      setError(failure.message);
      setBusyKey(null);
    }
  }

  const actions: TileActions = {
    connect: (app) => void connectFromTile(app.slug, app),
    reconnect: (app, account) => void connectFromTile(account.ref, app, account.label ?? undefined),
    addAccount: (app, accounts) =>
      setNaming({
        kind: "add",
        app,
        accounts,
        unnamed: oldestFirst(accounts).filter((c) => c.label === null && c.status === "active"),
      }),
    rename: (app, account, accounts) => setNaming({ kind: "rename", app, account, accounts }),
    remove: (app, connection) => setRemoving({ connection, app }),
    cancelAttempt: (app, connection) => {
      setError(null);
      setBusyKey(cancelKey(connection));
      revoke(connection)
        .then(() => setToast({ tone: "ok", text: `הניסיון לחבר את ${accountName(appLabel(app.slug, app), connection)} בוטל` }))
        .catch(() => setError(UNEXPECTED_ERROR_HE))
        .finally(() => setBusyKey(null));
    },
  };

  const removingName = removing ? accountName(appLabel(removing.app.slug, removing.app), removing.connection) : "";
  const removingLive = removing?.connection.status === "active";

  return (
    <div className="bg-white rounded-[28px] border border-sand-light shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] p-5 sm:p-10">
      <Toast tone={toast?.tone ?? "ok"} text={toast?.text ?? null} onDismiss={() => setToast(null)} />

      <div className="flex items-start gap-3 sm:gap-5 mb-4">
        <BotAvatar name={botName} tone="warm" size="sm" />
        <div className="min-w-0">
          <p className={`${SECTION_LABEL} mb-1`}>חיבורים לאפליקציות</p>
          <h2 className="font-display text-xl sm:text-2xl text-espresso leading-tight text-balance break-words">
            האפליקציות של {botName}
          </h2>
        </div>
      </div>

      <p className="text-sm text-espresso-light leading-relaxed mb-5 max-w-lg">
        חברו אפליקציה בלחיצה אחת, ו־{botName} יוכל להשתמש בה מתוך וואטסאפ או טלגרם. אפשר לנתק בכל רגע.
      </p>

      {error ? (
        <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 mb-5">
          {error}
        </p>
      ) : null}

      <SearchField
        query={catalog.query}
        onQuery={catalog.setQuery}
        searching={catalog.busy === "search"}
        total={overview.browse.total}
      />

      {catalog.failed ? (
        <p role="alert" className="text-sm text-red-700 mb-3">
          {UNEXPECTED_ERROR_HE}
        </p>
      ) : null}

      {catalog.listing.apps.length > 0 ? (
        <ul
          className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${catalog.busy === "search" ? "opacity-60" : ""}`}
          aria-busy={catalog.busy === "search"}
        >
          {tiles.map(({ app, accounts }) => (
            <AppTile key={app.slug} app={app} accounts={accounts} busyKey={busyKey} actions={actions} />
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed border-sand-light bg-cream/50 px-4 py-8 text-center">
          <p className="text-sm text-espresso" aria-live="polite">
            {catalog.busy === "search" ? "מחפשים…" : `לא מצאנו אפליקציה בשם "${searchTerm}".`}
          </p>
          {catalog.busy === "search" ? null : (
            <p className="mt-1.5 text-xs text-espresso-light">נסו שם אחר, או חלק ממנו.</p>
          )}
        </div>
      )}

      {catalog.hasMore ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={catalog.loadMore}
            disabled={catalog.busy !== null}
            className="min-h-11 px-5 py-2.5 rounded-full border border-sand text-espresso text-sm font-medium hover:bg-cream-dark transition disabled:opacity-60 disabled:cursor-wait focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            {catalog.busy === "more" ? "טוענים…" : "עוד אפליקציות"}
          </button>
        </div>
      ) : null}

      <p className="mt-10 pt-6 border-t border-sand-light/70">
        <PendingLink
          href="/app"
          className="inline-flex min-h-11 items-center gap-1.5 -ms-2 px-2 rounded-lg text-sm text-terra hover:text-terra-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-terra transition"
        >
          <BackChevron />
          <span>חזרה לבית שלי</span>
        </PendingLink>
      </p>

      <ConfirmDialog
        open={removing !== null}
        title={removingLive ? `לנתק את ${removingName}?` : `להסיר את ${removingName}?`}
        description={
          removingLive
            ? `${botName} לא יוכל יותר להשתמש ב־${removingName}, וההרשאה שנתתם תבוטל אצל השירות. אפשר לחבר מחדש בכל רגע.`
            : `החיבור הזה כבר לא פעיל, ו־${botName} לא משתמש בו. אפשר לחבר אותו מחדש בכל רגע.`
        }
        confirmLabel={removingLive ? "ניתוק" : "הסרה"}
        busyLabel={removingLive ? "מנתקים…" : "מסירים…"}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing) {
            await revoke(removing.connection);
            setToast({ tone: "ok", text: `${removingName} ${removingLive ? "נותק" : "הוסר"}` });
          }
          setRemoving(null);
        }}
      />

      <NamingDialog
        request={naming}
        botName={botName}
        onClose={() => setNaming(null)}
        onAdd={async (request, values) => {
          for (const account of request.unnamed) {
            const failure = await requestRename(request.app, account, values[account.ref] ?? "");
            if (failure) return failure;
          }
          return requestConnect(request.app, values[NEW_ACCOUNT_FIELD]);
        }}
        onRename={async (request, label) => {
          const failure = await requestRename(request.app, request.account, label);
          if (failure) return failure;
          setNaming(null);
          setToast({ tone: "ok", text: `השם עודכן ל־${isolate(label)}` });
          return null;
        }}
      />
    </div>
  );
}

function NamingDialog({
  request,
  botName,
  onClose,
  onAdd,
  onRename,
}: {
  request: NamingRequest | null;
  botName: string;
  onClose: () => void;
  onAdd: (request: Extract<NamingRequest, { kind: "add" }>, values: Record<string, string>) => Promise<SubmitFailure | null>;
  onRename: (request: Extract<NamingRequest, { kind: "rename" }>, label: string) => Promise<SubmitFailure | null>;
}) {
  // Stays mounted after the request clears, so the native dialog closes (and hands focus back) itself.
  const [last, setLast] = useState(request);
  if (request && request !== last) setLast(request);
  const shown = request ?? last;

  const fields = useMemo<NameField[]>(() => {
    if (!shown) return [];
    if (shown.kind === "rename") {
      return [
        {
          key: shown.account.ref,
          label: "שם החשבון",
          initial: shown.account.label ?? "",
          placeholder: "למשל: עבודה",
          taken: labelsTakenForRename(shown.accounts, shown.account.ref),
        },
      ];
    }
    const existing = shown.unnamed.map((account, i) => ({
      key: account.ref,
      label:
        shown.unnamed.length > 1
          ? `שם לחשבון ה־${i + 1} (${connectedAtHe(account) ?? "מחובר"})`
          : "שם לחשבון שכבר מחובר",
      initial: "",
      placeholder: "למשל: עבודה",
      taken: labelsTakenForRename(shown.accounts, account.ref),
    }));
    const placeholder = existing.length > 0 ? "למשל: אישי" : "למשל: עבודה";
    return [
      ...existing,
      { key: NEW_ACCOUNT_FIELD, label: "שם לחשבון החדש", initial: "", placeholder, taken: labelsTakenForNew(shown.accounts) },
    ];
  }, [shown]);

  if (!shown) return null;
  const appName = appLabel(shown.app.slug, shown.app);
  const takenMessage = `כבר יש חשבון ${appName} בשם הזה`;

  if (shown.kind === "rename") {
    return (
      <AccountNamesDialog
        open={request !== null}
        title={shown.account.label ? `שינוי שם לחשבון ${appName}` : `שם לחשבון ${appName}`}
        description={`${botName} מזהה את החשבון לפי השם הזה, כשאתם מבקשים ממנו משהו.`}
        fields={fields}
        takenMessage={takenMessage}
        submitLabel="שמירה"
        busyLabel="שומרים…"
        onClose={onClose}
        onSubmit={(values) => onRename(shown, values[shown.account.ref] ?? "")}
      />
    );
  }

  return (
    <AccountNamesDialog
      open={request !== null}
      title={`חשבון ${appName} נוסף`}
      description={
        shown.unnamed.length > 0
          ? `כדי ש־${botName} ידע באיזה חשבון להשתמש, לכל חשבון צריך שם — למשל ״עבודה״ ו״אישי״.`
          : `תנו לחשבון החדש שם, כדי ש־${botName} ידע באיזה חשבון להשתמש — למשל ״עבודה״ או ״אישי״.`
      }
      fields={fields}
      takenMessage={takenMessage}
      footnote="בשלב הבא תבחרו איזה חשבון לחבר."
      submitLabel="המשך לחיבור"
      busyLabel="מעבירים…"
      onClose={onClose}
      onSubmit={(values) => onAdd(shown, values)}
    />
  );
}

function SearchField({
  query,
  onQuery,
  searching,
  total,
}: {
  query: string;
  onQuery: (value: string) => void;
  searching: boolean;
  total: number;
}) {
  return (
    <div className="mb-6">
      <div className="relative">
        <span aria-hidden className="absolute inset-y-0 start-0 ps-3.5 flex items-center text-espresso-light">
          <SearchIcon />
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={total > 0 ? `חיפוש מתוך ${total.toLocaleString("he-IL")} אפליקציות…` : "חיפוש אפליקציה לפי שם…"}
          aria-label="חיפוש אפליקציה לפי שם"
          aria-busy={searching}
          maxLength={CATALOG_QUERY_MAX_LENGTH}
          className="w-full min-h-11 ps-10 pe-4 py-2.5 rounded-xl border border-sand-light bg-cream text-sm text-espresso placeholder:text-espresso-light/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:border-terra transition"
        />
      </div>
    </div>
  );
}

type ListingBusy = "search" | "more" | null;
type PageResult = { ok: true; page: CatalogPage } | { ok: false; aborted: boolean };

// `cursor` is the catalog offset already fetched; the rendered list also holds hoisted apps.
interface Listing {
  apps: CatalogApp[];
  cursor: number;
  total: number;
}

// One paged query serves both search and browse; the ~1,400-app catalog stays in the orchestrator.
function useCatalogListing(start: Listing, hoist: (query: string) => CatalogApp[]) {
  const [query, setQuery] = useState("");
  const [listing, setListing] = useState<Listing>(start);
  const [busy, setBusy] = useState<ListingBusy>(null);
  const [failed, setFailed] = useState(false);
  // Every response carries the request number that asked for it; only the newest may land.
  const seq = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const fetchPage = useCallback(async (q: string, offset: number): Promise<PageResult> => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const params = new URLSearchParams({ limit: String(CATALOG_SEARCH_LIMIT), offset: String(offset) });
    if (q) params.set("q", q);
    try {
      const res = await fetch(`/api/integrations/catalog?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const parsed = CatalogResponseSchema.safeParse(await res.json().catch(() => null));
      if (!res.ok || !parsed.success) return { ok: false, aborted: false };
      return { ok: true, page: { apps: parsed.data.data, total: parsed.data.total ?? parsed.data.data.length } };
    } catch {
      return { ok: false, aborted: controller.signal.aborted };
    }
  }, []);

  useEffect(() => {
    const q = query.trim();
    const mine = ++seq.current;
    if (!q) {
      inFlight.current?.abort();
      setListing(start);
      setBusy(null);
      setFailed(false);
      return;
    }
    setBusy("search");
    const timer = setTimeout(async () => {
      const result = await fetchPage(q, 0);
      if (mine !== seq.current) return;
      setBusy(null);
      if (!result.ok) {
        setFailed(!result.aborted);
        return;
      }
      setFailed(false);
      setListing({
        apps: dedupe([...hoist(q), ...result.page.apps]),
        cursor: result.page.apps.length,
        total: result.page.total,
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, start, hoist, fetchPage]);

  const loadMore = useCallback(async () => {
    const mine = seq.current;
    setBusy("more");
    const result = await fetchPage(query.trim(), listing.cursor);
    if (mine !== seq.current) return;
    setBusy(null);
    if (!result.ok) {
      setFailed(!result.aborted);
      return;
    }
    setFailed(false);
    setListing((current) => ({
      apps: dedupe([...current.apps, ...result.page.apps]),
      cursor: current.cursor + result.page.apps.length,
      total: result.page.total,
    }));
  }, [fetchPage, query, listing.cursor]);

  return { query, setQuery, listing, busy, failed, loadMore, hasMore: listing.cursor < listing.total };
}

// The list hoists curated apps above the catalog page they also appear in, and a double click on
// "load more" can repeat a page: either way the same app must render once.
function dedupe(apps: readonly CatalogApp[]): CatalogApp[] {
  const seen = new Set<string>();
  return apps.filter((app) => {
    if (seen.has(app.slug)) return false;
    seen.add(app.slug);
    return true;
  });
}

interface TileModel {
  app: CatalogApp;
  accounts: IntegrationConnection[];
}

// The list is newest first; rows read oldest first, so an added account lands beside the button that added it.
function oldestFirst(accounts: readonly IntegrationConnection[]): IntegrationConnection[] {
  return [...accounts].reverse();
}

function cancelKey(account: IntegrationConnection): string {
  return `cancel:${account.ref}`;
}

// A tile with several accounts spans both columns; leading with them keeps the grid free of holes.
function wideTilesFirst(tiles: TileModel[]): TileModel[] {
  return [...tiles.filter((t) => t.accounts.length > 1), ...tiles.filter((t) => t.accounts.length <= 1)];
}

const TILE_PRIMARY =
  "shrink-0 inline-flex min-h-11 items-center justify-center px-4 py-2 rounded-full bg-terra text-white text-sm font-medium hover:bg-terra-dark transition disabled:opacity-60 disabled:cursor-wait focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 focus-visible:ring-offset-white";
const TILE_QUIET =
  "shrink-0 inline-flex min-h-11 items-center justify-center px-4 py-2 rounded-full border border-sand-light text-sm font-medium text-espresso-light hover:text-espresso hover:bg-cream-dark transition disabled:opacity-60 disabled:cursor-wait focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 focus-visible:ring-offset-white";
const TEXT_ACTION =
  "inline-flex min-h-11 items-center gap-1.5 -ms-2 px-2 rounded-lg text-sm font-medium text-terra hover:text-terra-dark transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra";
// Secondary actions stay small so the one-account tile looks as simple as it did before.
const QUIET_LINK =
  "inline-flex min-h-9 items-center gap-1 -ms-1.5 px-1.5 rounded-lg text-xs font-medium text-espresso-light hover:text-terra transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terra";

function AppTile({
  app,
  accounts,
  busyKey,
  actions,
}: {
  app: CatalogApp;
  accounts: IntegrationConnection[];
  busyKey: string | null;
  actions: TileActions;
}) {
  const name = appLabel(app.slug, app);
  const blurb = featuredApp(app.slug)?.blurbHe ?? "";
  const addable = canAddAccount(accounts);
  const onAdd = () => actions.addAccount(app, accounts);

  if (accounts.length > 1) {
    const ordered = oldestFirst(accounts);
    return (
      <li className="sm:col-span-2 rounded-2xl border border-sand-light bg-cream/40 px-4 pt-3 pb-1.5">
        <div className="flex items-center gap-3">
          <AppLogo app={app} name={name} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[15px] font-medium text-espresso">{name}</span>
              <span className="text-xs text-espresso-light">{accounts.length} חשבונות</span>
            </div>
            {blurb ? <p className="text-xs text-espresso-light truncate">{blurb}</p> : null}
          </div>
        </div>
        <ul aria-label={`החשבונות של ${name}`} className="mt-3 divide-y divide-sand-light/70 border-t border-sand-light/70">
          {ordered.map((account) => (
            <AccountRow key={account.ref} app={app} name={name} account={account} accounts={accounts} busyKey={busyKey} actions={actions} />
          ))}
        </ul>
        {addable ? (
          <div className="border-t border-sand-light/70 py-1">
            <AddAccountButton name={name} onClick={onAdd} />
          </div>
        ) : accounts.length >= INTEGRATION_MAX_ACCOUNTS_PER_APP ? (
          <p className="border-t border-sand-light/70 py-3 text-xs text-espresso-light">
            זה המקסימום: עד {INTEGRATION_MAX_ACCOUNTS_PER_APP} חשבונות לכל אפליקציה.
          </p>
        ) : null}
      </li>
    );
  }

  const account = accounts[0] ?? null;
  const status = tileStatus(account);
  const connected = account?.status === "active";
  const busy = busyKey === (account?.ref ?? app.slug);
  const needsReconnect = status?.tone === "error";

  return (
    <li className="flex items-center gap-3 rounded-2xl border border-sand-light bg-cream/40 px-4 py-3 min-h-[4.75rem]">
      <AppLogo app={app} name={name} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[15px] font-medium text-espresso">{name}</span>
          {account?.label ? (
            <span className="text-sm text-espresso-light break-words">
              · <bdi>{account.label}</bdi>
            </span>
          ) : null}
          {status ? (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TONE_CLASS[status.tone]}`}>
              {status.label}
            </span>
          ) : null}
        </div>
        {blurb ? <p className="text-xs text-espresso-light truncate">{blurb}</p> : null}
        {addable ? <AddAccountButton name={name} onClick={onAdd} quiet /> : null}
      </div>
      {connected && account ? (
        <button
          type="button"
          onClick={() => actions.remove(app, account)}
          aria-label={`ניתוק ${accountName(name, account)}`}
          className={TILE_QUIET}
        >
          ניתוק
        </button>
      ) : (
        <button
          type="button"
          // Through the account, so a named one is replaced under its name rather than joined by an unnamed one.
          onClick={() => (account ? actions.reconnect(app, account) : actions.connect(app))}
          disabled={busy}
          aria-label={`${needsReconnect ? "חיבור מחדש של" : "חיבור"} ${name}`}
          className={TILE_PRIMARY}
        >
          {busy ? "מעבירים…" : needsReconnect ? "חיבור מחדש" : "חיבור"}
        </button>
      )}
    </li>
  );
}

function AccountRow({
  app,
  name,
  account,
  accounts,
  busyKey,
  actions,
}: {
  app: CatalogApp;
  name: string;
  account: IntegrationConnection;
  accounts: IntegrationConnection[];
  busyKey: string | null;
  actions: TileActions;
}) {
  const status = tileStatus(account);
  const busy = busyKey === account.ref;
  const cancelling = busyKey === cancelKey(account);
  const fullName = accountName(name, account);
  const connectedAt =
    account.label === null && account.status === "active" && accounts.filter((c) => c.label === null).length > 1
      ? connectedAtHe(account)
      : null;

  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`text-sm font-medium break-words ${account.label ? "text-espresso" : "text-espresso-light"}`}>
            <bdi>{account.label ?? UNNAMED_ACCOUNT_HE}</bdi>
          </span>
          {status ? (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TONE_CLASS[status.tone]}`}>{status.label}</span>
          ) : null}
          {connectedAt ? <span className="text-xs text-espresso-light">{connectedAt}</span> : null}
        </div>
        {account.status === "active" ? (
          <button
            type="button"
            onClick={() => actions.rename(app, account, accounts)}
            aria-label={account.label ? `שינוי השם של ${fullName}` : `מתן שם לחשבון ${name}`}
            className={QUIET_LINK}
          >
            {account.label ? "שינוי שם" : "תנו לו שם"}
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {account.status === "active" ? (
          <button type="button" onClick={() => actions.remove(app, account)} aria-label={`ניתוק ${fullName}`} className={TILE_QUIET}>
            ניתוק
          </button>
        ) : account.status === "pending" ? (
          <>
            {/* For whoever closed the consent page: a new link replaces this attempt under the same name. */}
            <button
              type="button"
              onClick={() => actions.reconnect(app, account)}
              disabled={busy || cancelling}
              aria-label={`המשך החיבור של ${fullName}`}
              className={TILE_PRIMARY}
            >
              {busy ? "מעבירים…" : "המשך חיבור"}
            </button>
            <button
              type="button"
              onClick={() => actions.cancelAttempt(app, account)}
              disabled={busy || cancelling}
              aria-label={`ביטול החיבור של ${fullName}`}
              className={TILE_QUIET}
            >
              {cancelling ? "מבטלים…" : "ביטול"}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => actions.reconnect(app, account)}
              disabled={busy}
              aria-label={`חיבור מחדש של ${fullName}`}
              className={TILE_PRIMARY}
            >
              {busy ? "מעבירים…" : "חיבור מחדש"}
            </button>
            <button type="button" onClick={() => actions.remove(app, account)} aria-label={`הסרת ${fullName}`} className={TILE_QUIET}>
              הסרה
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function AddAccountButton({ name, onClick, quiet = false }: { name: string; onClick: () => void; quiet?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={`חיבור חשבון ${name} נוסף`} className={quiet ? QUIET_LINK : TEXT_ACTION}>
      <PlusIcon />
      <span>חשבון נוסף</span>
    </button>
  );
}

function AppLogo({ app, name }: { app: CatalogApp; name: string }) {
  return (
    <span aria-hidden className="shrink-0 w-10 h-10 rounded-full bg-white border border-sand-light flex items-center justify-center overflow-hidden">
      {app.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={app.logo} alt="" className="w-6 h-6 object-contain" />
      ) : (
        <span className="text-espresso-light text-sm font-medium">{name.slice(0, 1)}</span>
      )}
    </span>
  );
}

const TONE_CLASS: Record<TileTone, string> = {
  ok: "bg-sage-pale text-sage-dark",
  wait: "bg-terra-pale text-terra",
  muted: "bg-sand-light text-espresso-light",
  error: "bg-red-50 text-red-700",
};

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M10 4.5v11M4.5 10h11" strokeLinecap="round" />
    </svg>
  );
}

function Unavailable() {
  return (
    <div className="bg-white rounded-[28px] border border-sand-light shadow-[0_1px_0_rgba(44,24,16,0.04),0_24px_60px_-32px_rgba(44,24,16,0.18)] p-5 sm:p-10 max-w-2xl">
      <p className={`${SECTION_LABEL} mb-3`}>חיבורים לאפליקציות</p>
      <h2 className="font-display text-xl sm:text-2xl text-espresso mb-3">עוד לא זמין</h2>
      <p className="text-sm text-espresso-light leading-relaxed mb-5">
        חיבור אפליקציות עדיין לא פעיל בחשבון הזה. נעדכן אתכם ברגע שהוא ייפתח.
      </p>
      <PendingLink
        href="/app"
        className="inline-flex min-h-11 items-center gap-1.5 -ms-2 px-2 rounded-lg text-sm text-terra hover:text-terra-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-terra transition"
      >
        <BackChevron />
        <span>חזרה לבית שלי</span>
      </PendingLink>
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
