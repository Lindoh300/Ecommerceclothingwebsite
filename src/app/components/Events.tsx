import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { listEvents } from "../api/events";
import type { PublicEvent } from "../api/types";
import { eventPath } from "../lib/seo";
import { formatClock, formatEventDay } from "../utils/eventTime";
import { LoadState } from "./common/LoadState";
import { EventPoster, EventRow, eventPriceLine, useDaysToGo } from "./EventTiles";

/** The first sentence of a description, for the feature's lede. */
function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const m = flat.match(/^.*?[.!?](?=\s|$)/);
  return m ? m[0] : flat;
}

function Countdown({ iso }: { iso: string }) {
  const days = useDaysToGo(iso);
  if (days === null || days < 0) return null;
  if (days === 0) {
    return (
      <p className="ev-count">
        <span className="display ev-count-num ev-count-word">Tonight</span>
      </p>
    );
  }
  return (
    <p className="ev-count">
      <span className="display ev-count-num">{days}</span>
      <span className="ev-count-label">{days === 1 ? "day to go" : "days to go"}</span>
    </p>
  );
}

function FeatureEvent({ event }: { event: PublicEvent }) {
  const where = [event.venue, event.city].filter(Boolean).join(", ");
  const price = eventPriceLine(event);
  const meta = [formatEventDay(event.startsAt), `Doors ${formatClock(event.startsAt)}`, where].filter(Boolean).join(" · ");
  const lede = event.description ? firstSentence(event.description) : "";
  return (
    <section aria-label="Next event" className="band-tile ev-feature">
      <EventPoster event={event} />
      <div className="ev-feature-body">
        <Countdown iso={event.startsAt} />
        <h2 className="display h-mid break-words">{event.title}</h2>
        {lede && <p className="lede break-words">{lede}</p>}
        <p className="ev-feature-meta">{meta}</p>
        <div className="ev-feature-cta">
          <Link to={eventPath(event.slug)} className="cta">
            Get tickets
          </Link>
          {price && <span className="ev-feature-price">{price}</span>}
        </div>
      </div>
    </section>
  );
}

export function Events() {
  const [events, setEvents] = useState<PublicEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [past, setPast] = useState<PublicEvent[] | null>(null);
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

  const loadPast = useCallback(async () => {
    try {
      const list = await listEvents(true);
      if (live.current) setPast(list);
    } catch {
      // A failed past load shows nothing.
    }
  }, []);

  useEffect(() => {
    live.current = true;
    load();
    loadPast();
    return () => {
      live.current = false;
    };
  }, [load, loadPast]);

  const upcoming = [...(events ?? [])].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const [next, ...others] = upcoming;

  return (
    <div className="min-h-screen bg-paper py-12 md:py-16">
      <div className="max-w-[1360px] mx-auto px-6 space-y-16 md:space-y-24">
        <header>
          <p className="page-kicker micro text-b60 mb-3">4Nguru</p>
          <h1 className="display h-sec mb-4">Events</h1>
          <p className="page-sub">Doors, tickets and where to find us.</p>
        </header>

        <LoadState loading={events === null && error === null} error={error} onRetry={load}>
          {!next ? (
            <div className="border border-b10 r-card p-12 text-center">
              <p className="text-b60">No events announced yet.</p>
            </div>
          ) : (
            <div className="space-y-16 md:space-y-24">
              <FeatureEvent event={next} />
              {others.length > 0 && (
                <section aria-labelledby="events-also">
                  <h2 id="events-also" className="display h-sec mb-6">
                    Also coming
                  </h2>
                  <ul className="ev-wall">
                    {others.map((e) => (
                      <li key={e.id} className="min-w-0">
                        <EventPoster event={e} title />
                        <p className="ev-wall-meta">
                          <span>{formatEventDay(e.startsAt)}</span>
                          <span>{eventPriceLine(e)}</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </LoadState>

        {past && past.length > 0 && (
          <section aria-labelledby="events-past">
            <h2 id="events-past" className="display h-sec mb-6">
              Past nights
            </h2>
            <ul>
              {past.map((e) => (
                <li key={e.id}>
                  <EventRow event={e} action="Details" />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
