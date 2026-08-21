const TZ = "Asia/Jerusalem";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: TZ });
const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });

function parse(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(iso: string | null | undefined): string {
  const d = iso ? parse(iso) : null;
  return d ? DATE.format(d) : "—";
}

export function formatDateTime(iso: string | null | undefined): string {
  const d = iso ? parse(iso) : null;
  return d ? DATE_TIME.format(d) : "—";
}

export function formatTime(iso: string): string {
  const d = parse(iso);
  return d ? TIME.format(d) : "—";
}

export function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function StatCard({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-sand/30 bg-white p-5">
      <p className="text-sm text-espresso-light">{label}</p>
      <p className={`mt-1 text-3xl font-black tabular-nums ${accent ? "text-terra" : "text-espresso"}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-terra">{hint}</p> : null}
    </div>
  );
}

export function Th({ children, align = "left" }: { children?: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={`px-5 py-3.5 text-sm font-bold text-espresso ${align === "right" ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}
