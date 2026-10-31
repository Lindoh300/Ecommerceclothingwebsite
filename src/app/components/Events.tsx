import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { listEvents } from "../api/events";
import type { PublicEvent } from "../api/types";
import { eventPath } from "../lib/seo";
import { formatEventDate, formatPrice } from "../utils/eventTime";
import { LoadState } from "./common/LoadState";
import { ProductImage } from "./common/ProductImage";

/** "Free", "R250", "From R250", "Free and paid tickets", or a note when nothing is on sale. */
function priceLine(event: PublicEvent): string {
  const open = event.ticketTypes.filter((t) => t.onSale && t.available > 0);
  if (open.length === 0) return event.ticketTypes.length > 0 ? "Sold out or closed" : "";
  const lowest = Math.min(...open.map((t) => t.price));
  if (open.every((t) => t.price === lowest)) return formatPrice(lowest);
  return lowest === 0 ? "Free and paid tickets" : `From ${formatPrice(lowest)}`;
}

export function EventCard({ event }: { event: PublicEvent }) {
  const where = [event.venue, event.city].filter(Boolean).join(", ");
  const price = priceLine(event);
  return (
    <Link to={eventPath(event.slug)} className="group block border border-b10 r-card hover:border-ink transition-colors motion-reduce:transition-none">
      <div className="aspect-[16/9] overflow-hidden bg-b5">
        <ProductImage src={event.image} alt={event.title} />
      </div>
      <div className="p-4 md:p-6">
        <p className="micro text-b60 mb-2">{formatEventDate(event.startsAt)}</p>
        <h2 className="display h-mid mb-2 break-words">{event.title}</h2>
        {where && <p className="text-b60 break-words">{where}</p>}
        {price && <p className="mt-3">{price}</p>}
      </div>
    </Link>
  );
}

export function Events() {
  const [events, setEvents] = useState<PublicEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await listEvents();
      if (live.current) setEvents(list);
    } catch (err) {
      if (live.current) setError(err instanceof Error ? err.message : "Could not load events");
    }
  }, []);

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
        <p className="page-kicker micro text-b60 mb-3">4Nguru</p>
        <h1 className="display h-sec mb-10">Events</h1>
        <LoadState loading={events === null && error === null} error={error} onRetry={load}>
          {events && events.length === 0 ? (
            <div className="border border-b10 r-card p-12 text-center">
              <p className="text-b60">No events announced yet.</p>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {(events ?? []).map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </div>
          )}
        </LoadState>
      </div>
    </div>
  );
}
