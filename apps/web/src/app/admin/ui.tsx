import { DAY_MS } from "@/lib/billing/dates";

const TZ = "Asia/Jerusalem";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: TZ });
const DATE_YEAR = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const YEAR = new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: TZ });
const INT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Year only when it differs from today's, so a table of recent dates stays scannable.
export function formatDate(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return "—";
  return YEAR.format(d) === YEAR.format(new Date()) ? DATE.format(d) : DATE_YEAR.format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  const d = parse(iso);
  return d ? DATE_TIME.format(d) : "—";
}

export function formatTime(iso: string): string {
  const d = parse(iso);
  return d ? TIME.format(d) : "—";
}

export function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function int(value: number): string {
  return INT.format(value);
}

export function daysUntil(iso: string): number {
  const d = parse(iso);
  return d ? Math.ceil((d.getTime() - Date.now()) / DAY_MS) : 0;
}

export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-sand-light bg-white ${className}`}>{children}</div>;
}

// One strip of figures separated by hairlines reads as a single summary, not four competing cards.
export function Figures({ children }: { children: React.ReactNode }) {
  return <Panel className="mb-6 grid grid-cols-2 gap-px overflow-hidden bg-sand-light sm:grid-cols-4">{children}</Panel>;
}

export function Figure({ label, value, hint, attention }: { label: string; value: string; hint?: string; attention?: boolean }) {
  return (
    <div className="bg-white px-5 py-4">
      <p className="text-sm text-espresso-light">{label}</p>
      <p className={`mt-0.5 text-2xl font-bold tabular-nums ${attention ? "text-terra" : "text-espresso"}`}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-espresso-light">{hint}</p> : null}
    </div>
  );
}

export function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={`px-4 py-2.5 text-left text-xs font-semibold text-espresso-light ${className}`}>
      {children}
    </th>
  );
}

export function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{children}</span>;
}

export function Dot({ className }: { className: string }) {
  return <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${className}`} />;
}

// A thin bar of what is left: `remaining` of `total`; low means attention.
export function Meter({ remaining, total, low, label }: { remaining: number; total: number; low: boolean; label: string }) {
  const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((remaining / total) * 100))) : 0;
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.max(0, remaining)}
      aria-valuetext={label}
      className="mt-1.5 h-1 w-full max-w-[9rem] overflow-hidden rounded-full bg-cream-dark"
    >
      <div className={`h-full rounded-full ${low ? "bg-terra" : "bg-sage"}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

export function InlineError({ children, onRetry }: { children: React.ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-terra/30 bg-terra-pale px-4 py-2.5 text-sm text-terra-dark">
      <span>{children}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2">
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-14 text-center text-sm text-espresso-light">{children}</p>;
}

export const BUTTON = {
  primary:
    "inline-flex items-center justify-center rounded-lg bg-espresso px-3.5 py-2 text-sm font-medium text-cream transition-colors hover:bg-espresso-light focus:outline-none focus-visible:ring-2 focus-visible:ring-espresso focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center rounded-lg border border-sand px-3.5 py-2 text-sm font-medium text-espresso transition-colors hover:bg-cream-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-espresso focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  quiet:
    "inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 text-sm text-espresso-light transition-colors hover:bg-cream-dark hover:text-espresso focus:outline-none focus-visible:ring-2 focus-visible:ring-espresso focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 text-sm text-terra transition-colors hover:bg-terra-pale focus:outline-none focus-visible:ring-2 focus-visible:ring-terra focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
};
