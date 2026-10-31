import { useRef, useState } from "react";
import { Link } from "react-router";
import { Copy } from "lucide-react";
import { toast } from "../lib/toast";
import { ApiError } from "../api/client";
import { issueTickets, listEventTickets, voidTicket } from "../api/eventsAdmin";
import type { AdminEvent, AdminTicket } from "../api/types";
import { useAdminList } from "../hooks/useAdminList";
import { formatClock, formatPrice } from "../utils/eventTime";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-input-background px-3 text-base md:text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50";

function ticketStatus(t: AdminTicket): string {
  if (t.voidedAt) return "Void";
  if (t.checkedInAt) return `Used ${formatClock(t.checkedInAt)}`;
  return "Valid";
}

/** Issue tickets to someone who paid on WhatsApp or at the door, and see who holds the tickets of an event. */
export function AdminEventTickets({
  event,
  onChanged,
  onApiError,
}: {
  event: AdminEvent;
  /** Reload the events list (the sold counts changed). */
  onChanged: () => Promise<unknown>;
  onApiError: (err: unknown) => void;
}) {
  const tickets = useAdminList(() => listEventTickets(event.id), onApiError);
  const [typeId, setTypeId] = useState(event.ticketTypes[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<AdminTicket[] | null>(null);
  // One id per attempt: a retry or a double click returns the same tickets and takes no extra seats.
  const attemptId = useRef<string | null>(null);

  const refresh = async () => {
    await Promise.all([tickets.reload(), onChanged()]);
  };

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const qty = Number(quantity);
    if (!typeId) return void toast.error("Add a ticket type first");
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) return void toast.error("Quantity must be 1 to 20");
    if (!name.trim()) return void toast.error("Enter the holder's name");
    if (phone.replace(/\D/g, "").length < 7) return void toast.error("Enter a phone number with at least 7 digits");
    setBusy(true);
    attemptId.current ??= crypto.randomUUID();
    try {
      const r = await issueTickets({
        id: attemptId.current,
        ticketTypeId: typeId,
        quantity: qty,
        holder: { name: name.trim(), phone: phone.trim(), ...(email.trim() ? { email: email.trim() } : {}) },
      });
      attemptId.current = null;
      setIssued(r.tickets);
      setName("");
      setPhone("");
      setEmail("");
      setQuantity("1");
      toast.success(`Issued ${r.tickets.length} ${r.tickets.length === 1 ? "ticket" : "tickets"}`);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { code?: string; available?: number } | undefined;
        toast.error(
          body?.code === "sold_out"
            ? `Only ${body.available ?? 0} left in that ticket type`
            : err.message,
        );
        await onChanged();
      } else {
        onApiError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleVoid = async (t: AdminTicket) => {
    if (busy) return;
    if (!window.confirm(`Void the ticket for ${t.holderName}? The seat goes back on sale.`)) return;
    setBusy(true);
    try {
      await voidTicket(t.code);
      toast.success("Ticket voided");
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error("That ticket was already used at the door");
        await refresh();
      } else {
        onApiError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (code: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/ticket/${code}`);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy. Open the ticket and copy its address.");
    }
  };

  const list = tickets.data;
  const live = list.filter((t) => !t.voidedAt);
  const used = live.filter((t) => t.checkedInAt).length;

  return (
    <div className="space-y-8">
      <form onSubmit={handleIssue} className="border border-b10 r-card p-4 space-y-4" noValidate aria-label="Issue tickets">
        <h3 className="display h-mid">Issue tickets</h3>
        <p className="text-sm text-b60">For someone who paid on WhatsApp or at the door. Each ticket gets its own QR link.</p>
        {event.ticketTypes.length === 0 ? (
          <p className="text-b60">Add a ticket type in the event first.</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor={`issue-type-${event.id}`}>Ticket type</Label>
                <select id={`issue-type-${event.id}`} className={selectClass} value={typeId} disabled={busy} onChange={(e) => setTypeId(e.target.value)}>
                  {event.ticketTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({formatPrice(t.price)}, {t.available} left)
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`issue-qty-${event.id}`}>Quantity (1 to 20)</Label>
                <Input id={`issue-qty-${event.id}`} type="number" inputMode="numeric" min={1} max={20} step={1} value={quantity} disabled={busy} onChange={(e) => setQuantity(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`issue-name-${event.id}`}>Holder name</Label>
                <Input id={`issue-name-${event.id}`} value={name} maxLength={80} disabled={busy} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`issue-phone-${event.id}`}>Phone</Label>
                <Input id={`issue-phone-${event.id}`} type="tel" value={phone} maxLength={20} disabled={busy} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`issue-email-${event.id}`}>Email (optional)</Label>
                <Input id={`issue-email-${event.id}`} type="email" value={email} maxLength={254} disabled={busy} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            <button type="submit" disabled={busy} className="cta">
              {busy ? "Working…" : "Issue tickets"}
            </button>
          </>
        )}
        {issued && (
          <div role="status" className="border border-prism p-4">
            <p className="micro mb-3">Issued. Send each link to the holder.</p>
            <ul className="space-y-3">
              {issued.map((t, i) => (
                <li key={t.code} className="flex flex-wrap items-center gap-3">
                  <Link to={`/ticket/${t.code}`} target="_blank" rel="noopener noreferrer" className="linkr">
                    Ticket {i + 1}: {t.holderName}
                  </Link>
                  <button type="button" onClick={() => void copyLink(t.code)} className="linkr" aria-label={`Copy link for ticket ${i + 1}`}>
                    <Copy className="w-4 h-4" aria-hidden="true" />
                    Copy link
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>

      <div>
        <h3 className="display h-mid mb-2">Tickets</h3>
        <p className="micro text-b60 mb-4">
          {live.length} valid or used, {used} checked in, {list.length - live.length} void
        </p>
        {tickets.loading && list.length === 0 && <p className="micro text-b60">Loading tickets…</p>}
        {tickets.error && <p className="text-b60">Couldn't load tickets: {tickets.error}</p>}
        {!tickets.loading && !tickets.error && list.length === 0 && <p className="text-b60">No tickets yet.</p>}
        {list.length > 0 && (
          <ul className="border-t border-b10">
            {list.map((t) => (
              <li key={t.id} className={`py-4 border-b border-b10 ${t.voidedAt ? "text-b60" : ""}`}>
                <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                  <p className="break-words min-w-0">{t.holderName}</p>
                  <p className="micro">{ticketStatus(t)}</p>
                </div>
                <p className="text-sm text-b60 break-words">
                  {t.ticketTypeName} | {t.source === "rsvp" ? "RSVP" : "Issued"} | {t.holderPhone}
                  {t.holderEmail ? ` | ${t.holderEmail}` : ""}
                </p>
                <p className="font-mono text-xs text-b60 break-all mt-1">{t.code}</p>
                <div className="flex flex-wrap gap-4 mt-2">
                  <Link to={`/ticket/${t.code}`} target="_blank" rel="noopener noreferrer" className="linkr">
                    Open
                  </Link>
                  <button type="button" onClick={() => void copyLink(t.code)} className="linkr">
                    Copy link
                  </button>
                  {!t.voidedAt && !t.checkedInAt && (
                    <button type="button" onClick={() => void handleVoid(t)} disabled={busy} className="linkr">
                      Void
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
