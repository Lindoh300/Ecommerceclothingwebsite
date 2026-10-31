import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, WifiOff, XCircle } from "lucide-react";
import { ApiError } from "../api/client";
import { checkInTicket, listAdminEvents, listEventTickets } from "../api/eventsAdmin";
import type { AdminEvent } from "../api/types";
import { useAdminList } from "../hooks/useAdminList";
import {
  type DoorConflict,
  type DoorState,
  extractCode,
  loadDoorState,
  saveDoorState,
  scanLocally,
  summarise,
  toDoorTicket,
  upsertTicket,
} from "../utils/door";
import { formatClock, formatEventDate } from "../utils/eventTime";
import type { AdminSectionProps } from "./adminSections";
import { DoorScanner } from "./DoorScanner";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type ResultKind = "valid" | "already" | "void" | "not_found" | "wrong_event" | "error";

/** What the screen shows after a scan. The colour token and the words always go together. */
interface ScanResult {
  kind: ResultKind;
  headline: string;
  detail?: string;
  name?: string;
  ticketType?: string;
  /** Valid, but only saved on this device so far. */
  offline?: boolean;
}

const RESULT_STYLE: Record<ResultKind, string> = {
  valid: "bg-prism text-on-accent border-prism",
  already: "bg-ink text-paper border-ink",
  void: "bg-destructive text-destructive-foreground border-destructive",
  not_found: "bg-destructive text-destructive-foreground border-destructive",
  wrong_event: "bg-destructive text-destructive-foreground border-destructive",
  error: "bg-b5 text-ink border-ink",
};

const CONFLICT_TEXT: Record<DoorConflict["reason"], string> = {
  already: "was already checked in",
  void: "is void",
  not_found: "was not found",
  wrong_event: "is for another event",
};

/** A request that failed to reach the server, or the server failing: the cases where the door carries on offline. */
const isNetworkFailure = (err: unknown): boolean =>
  !(err instanceof ApiError) || err.status === 0 || err.status >= 500;

const isAuthFailure = (err: unknown): boolean => err instanceof ApiError && (err.status === 401 || err.status === 403);

function ResultPanel({ result }: { result: ScanResult }) {
  const Icon = result.kind === "valid" ? CheckCircle2 : result.kind === "already" || result.kind === "error" ? AlertTriangle : XCircle;
  return (
    <div role="status" aria-live="polite" className={`border-4 p-6 text-center ${RESULT_STYLE[result.kind]}`}>
      <Icon className="w-12 h-12 mx-auto mb-3" aria-hidden="true" />
      <p className="font-display h-weight h-case h-track-sm text-4xl md:text-5xl break-words">{result.headline}</p>
      {result.detail && <p className="mt-2 text-lg break-words">{result.detail}</p>}
      {(result.name || result.ticketType) && (
        <p className="mt-3 break-words">
          {[result.name, result.ticketType].filter(Boolean).join(" | ")}
        </p>
      )}
      {result.offline && <p className="mt-3 font-mono text-sm">Saved offline, will sync</p>}
    </div>
  );
}

function DoorEvent({ event, onApiError, onBack }: { event: AdminEvent; onApiError: (e: unknown) => void; onBack: () => void }) {
  // The parent makes a new onApiError each render. Callers below need a stable one, or the list would reload each render.
  const onApiErrorRef = useRef(onApiError);
  useEffect(() => {
    onApiErrorRef.current = onApiError;
  });
  const reportError = useCallback((err: unknown) => onApiErrorRef.current(err), []);
  const [door, setDoor] = useState<DoorState | null>(null);
  const doorRef = useRef<DoorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [manual, setManual] = useState("");
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  const alive = useRef(true);
  const eventId = event.id;

  /** Keeps the state in memory, on screen and on the device. */
  const commit = useCallback(
    (next: DoorState) => {
      doorRef.current = next;
      setDoor(next);
      saveDoorState(eventId, next);
    },
    [eventId],
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Sends the queued offline scans one by one, oldest first, with their scan times. Stops at the first failure to reach the server. */
  const sync = useCallback(async () => {
    if (syncingRef.current || !doorRef.current || doorRef.current.queue.length === 0) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      while (doorRef.current && doorRef.current.queue.length > 0) {
        const state = doorRef.current;
        const [scan, ...rest] = state.queue;
        let r;
        try {
          r = await checkInTicket(scan.code, { at: scan.at, eventId });
        } catch (err) {
          if (isAuthFailure(err)) reportError(err);
          break; // still offline (or signed out): the rest stays queued
        }
        const local = state.tickets.find((t) => t.code === scan.code);
        const name = local?.holderName ?? r.ticket?.holderName ?? "Unknown";
        let conflicts = state.conflicts;
        let tickets = state.tickets;
        if (r.result === "ok") {
          if (r.ticket) tickets = upsertTicket(tickets, toDoorTicket(r.ticket));
        } else if (r.result === "already") {
          // Our own earlier send that got through (same time) is not a conflict. Someone else's scan is.
          const same = r.checkedInAt && Math.abs(Date.parse(r.checkedInAt) - Date.parse(scan.at)) < 2000;
          if (!same) {
            conflicts = [
              ...conflicts,
              { code: scan.code, name, scannedAt: scan.at, reason: "already", checkedInAt: r.checkedInAt ?? null },
            ];
          }
          if (r.ticket) tickets = upsertTicket(tickets, toDoorTicket(r.ticket));
        } else {
          conflicts = [
            ...conflicts,
            { code: scan.code, name, scannedAt: scan.at, reason: r.result, checkedInAt: r.checkedInAt ?? null },
          ];
          if (r.result === "void" && r.ticket) tickets = upsertTicket(tickets, toDoorTicket(r.ticket));
        }
        if (!alive.current) return;
        commit({ ...state, tickets, queue: rest, conflicts });
      }
    } finally {
      syncingRef.current = false;
      if (alive.current) setSyncing(false);
    }
  }, [commit, eventId, reportError]);

  /** Downloads the ticket list. Without a connection it falls back to the list saved on this device. */
  const download = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNotice(null);
    const stored = loadDoorState(eventId);
    try {
      const list = await listEventTickets(eventId);
      if (!alive.current) return;
      // Scans queued on this device are not on the server yet: keep them marked used.
      const queued = new Map((stored?.queue ?? []).map((q) => [q.code, q.at]));
      const tickets = list.map(toDoorTicket).map((t) => (queued.has(t.code) && !t.checkedInAt && !t.voidedAt ? { ...t, checkedInAt: queued.get(t.code)! } : t));
      commit({ tickets, queue: stored?.queue ?? [], conflicts: stored?.conflicts ?? [], savedAt: new Date().toISOString() });
      void sync();
    } catch (err) {
      if (!alive.current) return;
      if (isAuthFailure(err)) reportError(err);
      if (stored) {
        commit(stored);
        setNotice(`Offline. Using the ticket list saved on this device at ${formatClock(stored.savedAt)}.`);
      } else {
        setLoadError(isAuthFailure(err) ? "You are signed out." : "Could not download the ticket list, and none is saved on this device. Check the connection and try again.");
      }
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [commit, eventId, reportError, sync]);

  useEffect(() => {
    void download();
  }, [download]);

  // Track the connection, and send the queue when it comes back.
  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => {
      setOnline(true);
      void sync();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [sync]);

  /** The offline path: check the code against the list on the device, mark it used there, and queue it. */
  const scanOffline = (code: string) => {
    const state = doorRef.current;
    if (!state) return setResult({ kind: "error", headline: "No list", detail: "The ticket list is not loaded yet." });
    const nowIso = new Date().toISOString();
    const r = scanLocally(state.tickets, code, nowIso);
    if (r.result === "unknown") {
      return setResult({
        kind: "not_found",
        headline: "Not found",
        detail: "Not on the list saved on this device. It may have been issued after you opened this event.",
      });
    }
    const base = { name: r.ticket.holderName, ticketType: r.ticket.ticketTypeName };
    if (r.result === "void") return setResult({ kind: "void", headline: "Void", ...base });
    if (r.result === "already") {
      return setResult({ kind: "already", headline: "Already used", detail: r.ticket.checkedInAt ? `At ${formatClock(r.ticket.checkedInAt)}` : undefined, ...base });
    }
    commit({ ...state, tickets: r.tickets, queue: [...state.queue, { code, at: nowIso }] });
    setResult({ kind: "valid", headline: "Valid", offline: true, ...base });
  };

  const handleCode = async (raw: string) => {
    const code = extractCode(raw);
    if (!code) {
      setResult({ kind: "not_found", headline: "Not found", detail: "That is not a ticket code." });
      return;
    }
    if (!navigator.onLine) return scanOffline(code);
    try {
      const r = await checkInTicket(code, { eventId });
      if (!alive.current) return;
      const state = doorRef.current;
      if (state && r.ticket && r.result !== "wrong_event") {
        commit({ ...state, tickets: upsertTicket(state.tickets, toDoorTicket(r.ticket)) });
      }
      const base = r.ticket ? { name: r.ticket.holderName, ticketType: r.ticket.ticketTypeName } : {};
      switch (r.result) {
        case "ok":
          setResult({ kind: "valid", headline: "Valid", ...base });
          break;
        case "already":
          setResult({ kind: "already", headline: "Already used", detail: r.checkedInAt ? `At ${formatClock(r.checkedInAt)}` : undefined, ...base });
          break;
        case "void":
          setResult({ kind: "void", headline: "Void", detail: "This ticket was cancelled.", ...base });
          break;
        case "wrong_event":
          setResult({ kind: "wrong_event", headline: "Wrong event", detail: r.ticket ? `This ticket is for ${r.ticket.eventTitle}.` : undefined, ...base });
          break;
        default:
          setResult({ kind: "not_found", headline: "Not found" });
      }
    } catch (err) {
      if (!alive.current) return;
      if (isAuthFailure(err)) {
        reportError(err);
        setResult({ kind: "error", headline: "Signed out", detail: "Sign in again, then scan again." });
      } else if (isNetworkFailure(err)) {
        scanOffline(code);
      } else {
        setResult({ kind: "error", headline: "Error", detail: err instanceof Error ? err.message : "Something went wrong" });
      }
    }
  };

  const handleManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manual.trim()) return;
    void handleCode(manual);
    setManual("");
  };

  const counts = door ? summarise(door.tickets) : { sold: 0, checkedIn: 0 };
  const queued = door?.queue.length ?? 0;
  const conflicts = door?.conflicts ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="min-w-0">
          <p className="micro text-b60">{formatEventDate(event.startsAt)}</p>
          <h2 className="display h-mid break-words">{event.title}</h2>
        </div>
        <button type="button" onClick={onBack} className="linkr">
          Change event
        </button>
      </div>

      {(!online || notice) && (
        <p role="status" className="border border-ink p-3 mb-4 flex items-start gap-2 text-sm">
          <WifiOff className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{notice ?? "Offline. Scans are checked against the list on this device and sent when the connection returns."}</span>
        </p>
      )}

      {loading && !door && <p className="micro text-b60 py-8 text-center">Downloading the ticket list…</p>}
      {loadError && (
        <div className="border border-b10 p-6 text-center">
          <p className="text-b60 mb-4">{loadError}</p>
          <button type="button" className="linkr mx-auto" onClick={() => void download()}>
            Try again
          </button>
        </div>
      )}

      {door && (
        <>
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="border border-b10 p-4">
              <p className="micro text-b60">Checked in</p>
              <p className="font-mono text-3xl" aria-label={`${counts.checkedIn} of ${counts.sold} checked in`}>
                {counts.checkedIn} / {counts.sold}
              </p>
            </div>
            <div className="border border-b10 p-4">
              <p className="micro text-b60">Waiting to sync</p>
              <p className="font-mono text-3xl">{queued}</p>
            </div>
          </div>

          <div className="mb-6 min-h-40">
            {result ? (
              <ResultPanel result={result} />
            ) : (
              <p className="border border-b10 p-6 text-center text-b60">Scan a ticket or type its code. The result shows here.</p>
            )}
          </div>

          <form onSubmit={handleManual} className="mb-6 flex flex-wrap items-end gap-3">
            <div className="grow min-w-0 basis-56">
              <Label htmlFor="door-code">Ticket code or link</Label>
              <Input
                id="door-code"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="Paste or type the code"
                className="font-mono"
              />
            </div>
            <button type="submit" className="cta" disabled={!manual.trim()}>
              Check
            </button>
          </form>

          <div className="mb-8">
            <DoorScanner onCode={(text) => void handleCode(text)} />
          </div>

          <div className="flex flex-wrap items-center gap-4 mb-6">
            <button type="button" className="linkr" onClick={() => void sync()} disabled={syncing || queued === 0}>
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            <button type="button" className="linkr" onClick={() => void download()} disabled={loading}>
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              Refresh list
            </button>
            <p className="micro text-b60">List saved {formatClock(door.savedAt) || ""}</p>
          </div>

          {conflicts.length > 0 && (
            <div className="border border-ink p-4" role="region" aria-label="Scans that did not sync">
              <p className="micro mb-3">Offline scans the server did not accept</p>
              <ul className="space-y-3">
                {conflicts.map((c, i) => (
                  <li key={`${c.code}-${i}`} className="text-sm break-words">
                    <span className="font-medium">{c.name}</span> {CONFLICT_TEXT[c.reason]}.{" "}
                    <span className="text-b60">
                      You scanned at {formatClock(c.scannedAt)}
                      {c.checkedInAt ? `; checked in at ${formatClock(c.checkedInAt)}` : ""}.
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="linkr mt-4"
                onClick={() => doorRef.current && commit({ ...doorRef.current, conflicts: [] })}
              >
                Dismiss
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The Door section: pick an event, then scan tickets or type their codes. Works through poor signal. */
export function AdminDoor({ onApiError }: AdminSectionProps) {
  const events = useAdminList(listAdminEvents, onApiError);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Cancelled events have no door. Soonest first, the way the public sees them.
  const choices = events.data
    .filter((e) => e.status !== "cancelled")
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const selected = choices.find((e) => e.id === selectedId) ?? null;

  if (selected) {
    return <DoorEvent key={selected.id} event={selected} onApiError={onApiError} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div>
      <h2 className="display h-mid mb-6">Door</h2>
      <p className="text-b60 mb-6">Choose the event you are checking people in to.</p>
      {events.loading && choices.length === 0 && <p className="micro text-b60">Loading events…</p>}
      {events.error && (
        <p className="text-b60">
          Couldn't load events: {events.error}{" "}
          <button type="button" className="linkr inline-flex" onClick={() => void events.reload()}>
            Try again
          </button>
        </p>
      )}
      {!events.loading && !events.error && choices.length === 0 && <p className="text-b60">No events yet. Create one in Events.</p>}
      <ul className="space-y-3">
        {choices.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => setSelectedId(e.id)}
              className="w-full text-left border border-b10 r-card p-4 min-h-11 hover:border-ink transition-colors motion-reduce:transition-none"
            >
              <span className="micro text-b60 block">
                {formatEventDate(e.startsAt)}
                {e.status === "draft" ? " | Draft" : ""}
              </span>
              <span className="block break-words text-lg">{e.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
