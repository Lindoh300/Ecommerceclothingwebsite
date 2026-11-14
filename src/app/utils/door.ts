// Door check-in helpers: reading a scanned code, the ticket list kept on the device, and offline scans. Admin only;
// nothing here runs while a page renders, and every use of storage is guarded.
import type { AdminTicket } from "../api/types";

/** What the door keeps of a ticket on the device. No phone number or email: the door never needs them. */
export interface DoorTicket {
  code: string;
  holderName: string;
  ticketTypeName: string;
  checkedInAt: string | null;
  voidedAt: string | null;
}

/** A scan made while the server could not be reached, waiting to be sent with its scan time. */
export interface QueuedScan {
  code: string;
  at: string;
}

export type ConflictReason = "already" | "void" | "not_found" | "wrong_event";

/** A queued scan the server did not accept when it was sent. */
export interface DoorConflict {
  code: string;
  name: string;
  scannedAt: string;
  reason: ConflictReason;
  /** When the server says the ticket was checked in, if it was. */
  checkedInAt: string | null;
}

export interface DoorState {
  tickets: DoorTicket[];
  queue: QueuedScan[];
  conflicts: DoorConflict[];
  /** When the ticket list was last downloaded. */
  savedAt: string;
}

const CODE_RE = /^[0-9a-zA-Z]{16,64}$/;
const TICKET_URL_RE = /\/ticket\/([0-9a-zA-Z]{16,64})(?:[/?#]|$)/;

/** The ticket code in what a scanner or a keyboard gave: the full ticket URL, or the bare code. null if it is neither. */
export function extractCode(raw: string): string | null {
  const text = raw.trim();
  if (CODE_RE.test(text)) return text.toLowerCase();
  const m = TICKET_URL_RE.exec(text);
  return m ? m[1].toLowerCase() : null;
}

export function toDoorTicket(t: AdminTicket): DoorTicket {
  return {
    code: t.code.toLowerCase(),
    holderName: t.holderName,
    ticketTypeName: t.ticketTypeName,
    checkedInAt: t.checkedInAt,
    voidedAt: t.voidedAt,
  };
}

/** Tickets that count as sold (not void), and how many of them are checked in. */
export function summarise(tickets: DoorTicket[]): { sold: number; checkedIn: number } {
  let sold = 0;
  let checkedIn = 0;
  for (const t of tickets) {
    if (t.voidedAt) continue;
    sold += 1;
    if (t.checkedInAt) checkedIn += 1;
  }
  return { sold, checkedIn };
}

export type LocalScan =
  | { result: "ok" | "already" | "void"; ticket: DoorTicket; tickets: DoorTicket[] }
  | { result: "unknown"; tickets: DoorTicket[] };

/** Checks a code against the list on the device. A valid ticket is marked used at `nowIso`. Returns a new list. */
export function scanLocally(tickets: DoorTicket[], code: string, nowIso: string): LocalScan {
  const found = tickets.find((t) => t.code === code);
  if (!found) return { result: "unknown", tickets };
  if (found.voidedAt) return { result: "void", ticket: found, tickets };
  if (found.checkedInAt) return { result: "already", ticket: found, tickets };
  const used = { ...found, checkedInAt: nowIso };
  return { result: "ok", ticket: used, tickets: tickets.map((t) => (t.code === code ? used : t)) };
}

/** Puts a ticket into the list, replacing the one with the same code. */
export function upsertTicket(tickets: DoorTicket[], ticket: DoorTicket): DoorTicket[] {
  return tickets.some((t) => t.code === ticket.code)
    ? tickets.map((t) => (t.code === ticket.code ? ticket : t))
    : [...tickets, ticket];
}

const key = (eventId: string) => `door_state_v1_${eventId}`;

const isState = (v: unknown): v is DoorState => {
  const s = v as DoorState | null;
  return !!s && Array.isArray(s.tickets) && Array.isArray(s.queue) && Array.isArray(s.conflicts) && typeof s.savedAt === "string";
};

/** The list, queue and conflicts kept for an event, or null (nothing saved, or storage is blocked). */
export function loadDoorState(eventId: string): DoorState | null {
  try {
    const text = window.localStorage.getItem(key(eventId));
    if (!text) return null;
    const parsed: unknown = JSON.parse(text);
    return isState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Keeps the state on the device. Failing (storage full or blocked) is not an error: the screen still has it in memory. */
export function saveDoorState(eventId: string, state: DoorState): boolean {
  try {
    window.localStorage.setItem(key(eventId), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
