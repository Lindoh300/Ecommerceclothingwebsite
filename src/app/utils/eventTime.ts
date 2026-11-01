// Event times are shown in South African time (UTC+2, no daylight saving) whatever the visitor's clock says. The
// formatting is done by hand, not with Intl, so the server HTML and the browser agree to the character.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

/** The date parts of an ISO time as they read in South Africa, or null for a bad date. */
function sastParts(iso: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + SAST_OFFSET_MS);
  return {
    day: d.getUTCDay(),
    date: d.getUTCDate(),
    month: d.getUTCMonth(),
    year: d.getUTCFullYear(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
  };
}

/** "Sat 5 Dec 2026, 18:00" */
export function formatEventDate(iso: string): string {
  const p = sastParts(iso);
  if (!p) return "";
  return `${DAYS[p.day]} ${p.date} ${MONTHS[p.month]} ${p.year}, ${pad(p.hours)}:${pad(p.minutes)}`;
}

/** "18:00" */
export function formatClock(iso: string): string {
  const p = sastParts(iso);
  return p ? `${pad(p.hours)}:${pad(p.minutes)}` : "";
}

/** The value of a `datetime-local` input ("2026-12-05T18:00") for an ISO time, read as South African time. */
export function isoToInput(iso: string | null | undefined): string {
  const p = iso ? sastParts(iso) : null;
  return p ? `${p.year}-${pad(p.month + 1)}-${pad(p.date)}T${pad(p.hours)}:${pad(p.minutes)}` : "";
}

/**
 * The ISO time for a `datetime-local` value, read as South African time. null for an empty or bad value, including a
 * date or time that does not exist (30 February, month 13, hour 24). Those would otherwise roll over to a later time.
 */
export function inputToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  // setUTCFullYear (not Date.UTC) so years 0 to 99 are not read as 1900 to 1999.
  const wall = new Date(0);
  wall.setUTCFullYear(y, mo - 1, d);
  wall.setUTCHours(h, mi, 0, 0);
  const roundTrips =
    wall.getUTCFullYear() === y &&
    wall.getUTCMonth() === mo - 1 &&
    wall.getUTCDate() === d &&
    wall.getUTCHours() === h &&
    wall.getUTCMinutes() === mi;
  if (!roundTrips) return null;
  const t = wall.getTime() - SAST_OFFSET_MS;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export const formatPrice = (price: number): string => (price === 0 ? "Free" : `R${price.toFixed(2).replace(/\.00$/, "")}`);
