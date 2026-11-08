// Timestamps are stored in UTC. Hospital-local display uses Asia/Riyadh (UTC+03:00, no DST).
const TZ = "Asia/Riyadh";

export function nowIso() {
  return new Date().toISOString();
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(iso));
}

/** Convert a UTC ISO string to a value for <input type="datetime-local"> in Riyadh time. */
export function toRiyadhInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 3 * 3600_000);
  return d.toISOString().slice(0, 16);
}

/** Convert a datetime-local value (entered in Riyadh time) to UTC ISO. */
export function fromRiyadhInput(v: string | null | undefined) {
  if (!v) return null;
  const d = new Date(`${v}:00+03:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Today's date in Riyadh as YYYY-MM-DD. */
export function riyadhToday() {
  return toRiyadhInput(nowIso()).slice(0, 10);
}

export function minutesBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

export function humanDuration(mins: number) {
  const sign = mins < 0 ? "-" : "";
  const m = Math.abs(mins);
  if (m < 60) return `${sign}${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${sign}${h}h ${m % 60}m`;
  return `${sign}${Math.floor(h / 24)}d ${h % 24}h`;
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "—";
  const m = minutesBetween(iso, nowIso());
  if (m < 1) return "just now";
  return `${humanDuration(m)} ago`;
}
