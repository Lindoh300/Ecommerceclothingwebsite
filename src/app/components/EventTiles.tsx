import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import type { PublicEvent } from "../api/types";
import { eventPath } from "../lib/seo";
import { daysUntil, eventDateTag, formatEventDay, formatPrice } from "../utils/eventTime";
import { ProductImage } from "./common/ProductImage";

/** "Free", "R250", "From R250", "Free and paid tickets", or a note when nothing is on sale. */
export function eventPriceLine(event: PublicEvent): string {
  const open = event.ticketTypes.filter((t) => t.onSale && t.available > 0);
  if (open.length === 0) return event.ticketTypes.length > 0 ? "Sold out or closed" : "";
  const lowest = Math.min(...open.map((t) => t.price));
  if (open.every((t) => t.price === lowest)) return formatPrice(lowest);
  return lowest === 0 ? "Free and paid tickets" : `From ${formatPrice(lowest)}`;
}

/** Days from today (South African date) to the event. null on the server and first render, set after mount. */
export function useDaysToGo(iso: string): number | null {
  const [days, setDays] = useState<number | null>(null);
  useEffect(() => {
    const n = daysUntil(iso, Date.now());
    setDays(Number.isNaN(n) ? null : n);
  }, [iso]);
  return days;
}

export function daysToGoLabel(days: number): string {
  if (days === 0) return "Tonight";
  return days === 1 ? "1 day to go" : `${days} days to go`;
}

export function EventPoster({
  event,
  link = true,
  title = false,
  className = "",
}: {
  event: PublicEvent;
  link?: boolean;
  title?: boolean;
  className?: string;
}) {
  const tag = eventDateTag(event.startsAt);
  const classes = ["ev-poster", className].filter(Boolean).join(" ");
  const body = (
    <>
      <span className="ev-poster-img">
        <ProductImage src={event.image} alt={event.title} />
      </span>
      <span className="ev-poster-date">
        <b>{tag.day}</b>
        <span>{tag.year}</span>
      </span>
      {title && (
        <span className="ev-poster-title">
          <span className="display">{event.title}</span>
          {event.city && <span className="ev-poster-city">{event.city}</span>}
        </span>
      )}
    </>
  );
  return link ? (
    <Link to={eventPath(event.slug)} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

export function EventRow({ event, action }: { event: PublicEvent; action?: string }) {
  const sub = [formatEventDay(event.startsAt), event.city].filter(Boolean).join(" · ");
  return (
    <Link to={eventPath(event.slug)} className="ev-row">
      <span className="ev-row-thumb">
        <ProductImage src={event.image} alt={event.title} />
      </span>
      <span className="ev-row-main">
        <span className="display ev-row-title">{event.title}</span>
        <span className="ev-row-sub">{sub}</span>
      </span>
      <span className="ev-row-go">
        {action}
        <ArrowRight aria-hidden="true" />
      </span>
    </Link>
  );
}
