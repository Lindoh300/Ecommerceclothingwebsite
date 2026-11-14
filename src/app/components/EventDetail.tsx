import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { getEvent, rsvp } from "../api/events";
import { ApiError } from "../api/client";
import type { PublicEvent, PublicTicketType } from "../api/types";
import { whatsappLink } from "../config/shop";
import { formatClock, formatEventDate, formatEventDay, formatPrice } from "../utils/eventTime";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { LoadState } from "./common/LoadState";
import { EventPoster, daysToGoLabel, useDaysToGo } from "./EventTiles";

const MAX_QUANTITY = 4;

interface EventDetailProps {
  /** The event the route loader fetched on the server. */
  initialEvent?: PublicEvent | null;
  /** The loader found no such event (the page is sent with status 404). */
  notFound?: boolean;
}

/** Countdown line, set after mount so it matches the server HTML. Never negative. */
function DaysToGo({ iso }: { iso: string }) {
  const days = useDaysToGo(iso);
  if (days === null || days < 0) return null;
  return <p className="micro text-b60 mb-3">{daysToGoLabel(days)}</p>;
}

function availabilityText(t: PublicTicketType): string {
  if (!t.onSale) return "Not on sale";
  if (t.available <= 0) return "Sold out";
  return t.available <= 10 ? `${t.available} left` : "Available";
}

/** The WhatsApp message for a paid ticket type. */
function ticketMessage(event: PublicEvent, type: PublicTicketType): string {
  return `Hi! I'd like tickets for ${event.title} (${formatEventDate(event.startsAt)}). Ticket: ${type.name}, ${formatPrice(type.price)} each. How many are left and how do I pay?`;
}

function RsvpForm({
  event,
  type,
  onDone,
  onStale,
}: {
  event: PublicEvent;
  type: PublicTicketType;
  /** Called after tickets were taken, so the availability can be refreshed. */
  onDone: () => void;
  /** Called when the server says the numbers on screen are out of date. */
  onStale: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  // One id per attempt: a retry or a double click returns the same tickets and never takes the seats twice.
  const attemptId = useRef<string | null>(null);

  const max = Math.max(1, Math.min(MAX_QUANTITY, type.available));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const holderName = name.trim();
    const holderPhone = phone.trim();
    const holderEmail = email.trim();
    if (!holderName) return setMessage("Enter your name.");
    if (holderPhone.replace(/\D/g, "").length < 7) return setMessage("Enter a phone number with at least 7 digits.");
    if (holderEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(holderEmail)) return setMessage("That email doesn't look right.");
    setBusy(true);
    setMessage(null);
    attemptId.current ??= crypto.randomUUID();
    try {
      const r = await rsvp(event.slug, {
        id: attemptId.current,
        ticketTypeId: type.id,
        quantity: Number(quantity),
        holder: { name: holderName, phone: holderPhone, ...(holderEmail ? { email: holderEmail } : {}) },
      });
      setCodes(r.tickets.map((t) => t.code));
      attemptId.current = null;
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { code?: string; available?: number } | undefined;
        if (body?.code === "sold_out") {
          setMessage(
            typeof body.available === "number" && body.available > 0
              ? `Only ${body.available} ${body.available === 1 ? "ticket is" : "tickets are"} left. Pick a smaller number.`
              : "Sorry, these tickets are sold out.",
          );
        } else {
          setMessage(err.message);
        }
        onStale();
      } else if (err instanceof ApiError && err.status === 429) {
        setMessage(err.message);
      } else if (err instanceof ApiError && err.status === 400) {
        setMessage(err.message);
      } else if (err instanceof ApiError && err.status === 404) {
        setMessage("This event is no longer available.");
        onStale();
      } else {
        setMessage("Could not reserve your tickets. Check your connection and try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (codes) {
    return (
      <div role="status" className="border border-brand p-4 mt-4">
        <p className="font-display h-weight h-case h-track-sm mb-2">You're in</p>
        <p className="text-sm text-b60 mb-4">
          Open each ticket to see its QR code. Save the links or screenshot the QR code: it is what you show at the door.
        </p>
        <ul className="space-y-2">
          {codes.map((code, i) => (
            <li key={code}>
              <Link to={`/ticket/${code}`} className="linkr">
                Ticket {i + 1}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border border-b10 r-card p-4 mt-4 space-y-4" noValidate aria-label={`RSVP for ${type.name}`}>
      <div className="space-y-1">
        <Label htmlFor={`rsvp-name-${type.id}`}>Name</Label>
        <Input id={`rsvp-name-${type.id}`} value={name} maxLength={80} autoComplete="name" disabled={busy} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`rsvp-phone-${type.id}`}>Phone</Label>
        <Input id={`rsvp-phone-${type.id}`} type="tel" value={phone} maxLength={20} autoComplete="tel" disabled={busy} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`rsvp-email-${type.id}`}>Email (optional)</Label>
        <Input id={`rsvp-email-${type.id}`} type="email" value={email} maxLength={254} autoComplete="email" disabled={busy} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`rsvp-qty-${type.id}`}>How many tickets</Label>
        <select
          id={`rsvp-qty-${type.id}`}
          value={quantity}
          disabled={busy}
          onChange={(e) => setQuantity(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-input-background px-3 text-base md:text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50"
        >
          {Array.from({ length: max }, (_, i) => String(i + 1)).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      {message && (
        <p role="alert" className="text-sm text-brand">
          {message}
        </p>
      )}
      <button type="submit" disabled={busy} className="cta w-full">
        {busy ? "Reserving…" : "Reserve free tickets"}
      </button>
    </form>
  );
}

export function EventDetail({ initialEvent = null, notFound = false }: EventDetailProps = {}) {
  const { slug = "" } = useParams();
  const [event, setEvent] = useState<PublicEvent | null>(initialEvent);
  const [gone, setGone] = useState(notFound);
  const [loading, setLoading] = useState(initialEvent === null && !notFound);
  const [error, setError] = useState<string | null>(null);
  const [openType, setOpenType] = useState<string | null>(null);
  const live = useRef(true);
  // True once an event is on screen, so a failed refresh keeps showing it instead of an error.
  const hasEvent = useRef(initialEvent !== null);

  // Loads (or refreshes) the event in the browser: the loader's copy can be a little old, and when the loader
  // failed there is no copy at all.
  const load = useCallback(async () => {
    setError(null);
    try {
      const e = await getEvent(slug);
      if (!live.current) return;
      hasEvent.current = e !== null;
      if (e) {
        setEvent(e);
        setGone(false);
      } else {
        setEvent(null);
        setGone(true);
      }
    } catch (err) {
      if (live.current && !hasEvent.current) setError(err instanceof Error ? err.message : "Could not load this event");
    } finally {
      if (live.current) setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    live.current = true;
    load();
    return () => {
      live.current = false;
    };
  }, [load]);

  return (
    <div className="min-h-screen bg-paper py-12 md:py-16">
      <div className="max-w-[1360px] mx-auto px-6">
        <LoadState loading={loading && !event} error={event ? null : error} onRetry={load}>
          {gone || !event ? (
            <div className="text-center py-12">
              <p className="page-kicker micro text-b60 mb-3">Events</p>
              <h1 className="display h-sec mb-6">Event not found</h1>
              <p className="text-b60 mb-10">We couldn't find that event. It may have been taken down.</p>
              <Link to="/events" className="cta">See events</Link>
            </div>
          ) : (
            <div className="ev-detail">
              <div className="ev-detail-poster">
                <EventPoster event={event} link={false} />
              </div>
              <div className="min-w-0">
                <Link to="/events" className="linkr mb-8 inline-flex items-center gap-2">
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                  All events
                </Link>
                <DaysToGo iso={event.startsAt} />
                <h1 className="display h-mid mb-6 break-words">{event.title}</h1>
                <dl className="facts mb-8">
                  <div>
                    <dt>Date</dt>
                    <dd>{formatEventDay(event.startsAt)}</dd>
                  </div>
                  <div>
                    <dt>Doors</dt>
                    <dd>{formatClock(event.startsAt)}</dd>
                  </div>
                  {event.venue && (
                    <div>
                      <dt>Venue</dt>
                      <dd className="break-words">{event.venue}</dd>
                    </div>
                  )}
                  {event.city && (
                    <div>
                      <dt>City</dt>
                      <dd className="break-words">{event.city}</dd>
                    </div>
                  )}
                </dl>
                {event.description && <p className="whitespace-pre-line break-words mb-10">{event.description}</p>}

                <h2 className="display h-mid mb-4">Tickets</h2>
                {event.ticketTypes.length === 0 ? (
                  <p className="text-b60 border border-b10 r-card p-6">Tickets aren't on sale yet.</p>
                ) : (
                  <ul className="border-t border-b10">
                    {event.ticketTypes.map((t) => {
                      const open = t.onSale && t.available > 0;
                      const free = t.price === 0;
                      return (
                        <li key={t.id} className="py-5 border-b border-b10">
                          <div className="flex flex-wrap justify-between items-baseline gap-x-4 gap-y-1">
                            <p className="break-words min-w-0">{t.name}</p>
                            <p>{formatPrice(t.price)}</p>
                          </div>
                          <p className={`micro mb-3 ${open ? "text-b60" : "text-ink"}`}>{availabilityText(t)}</p>
                          {open && free && openType !== t.id && (
                            <button type="button" className="cta" onClick={() => setOpenType(t.id)}>
                              RSVP for free
                            </button>
                          )}
                          {open && free && openType === t.id && (
                            <RsvpForm event={event} type={t} onDone={load} onStale={load} />
                          )}
                          {open && !free && (
                            <a
                              href={whatsappLink(ticketMessage(event, t))}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="cta"
                            >
                              <MessageCircle className="w-5 h-5" />
                              Get tickets on WhatsApp
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}
        </LoadState>
      </div>
    </div>
  );
}
