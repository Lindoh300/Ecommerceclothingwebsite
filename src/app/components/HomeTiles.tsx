import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { listEvents } from "../api/events";
import { getGallery } from "../api/community";
import type { Category, Product, PublicEvent, PublicGalleryItem } from "../api/types";
import { shop, whatsappLink } from "../config/shop";
import { eventPath } from "../lib/seo";
import { categoryPath } from "../utils/categoryPath";
import { formatClock, formatEventDay } from "../utils/eventTime";
import { ProductImage } from "./common/ProductImage";
import { EventPoster, eventPriceLine } from "./EventTiles";
import { SubscribeForm } from "./SubscribeForm";

/** Column spans (out of 12) for n category tiles: rows of three alternate 5-4-3 and 3-4-5; a short last row is 6-6 or 12. */
export function categorySpans(n: number): number[] {
  const spans: number[] = [];
  const full = Math.floor(n / 3);
  for (let r = 0; r < full; r++) spans.push(...(r % 2 === 0 ? [5, 4, 3] : [3, 4, 5]));
  const rest = n % 3;
  if (rest === 2) spans.push(6, 6);
  if (rest === 1) spans.push(12);
  return spans;
}

/** The right-hand hero tile: the first featured product. An empty Mist tile while loading. */
export function DropTile({ product }: { product?: Product }) {
  if (!product) return <div className="drop-tile" aria-hidden="true" />;
  return (
    <Link to={`/product/${product.id}`} className="drop-tile">
      <ProductImage src={product.image} alt={product.name} />
      <span className="stock-mark micro drop-tile-mark">New in</span>
      <span className="drop-tile-caption">
        <span className="drop-tile-name">{product.name}</span>
        <span className="drop-tile-price">R{product.price}</span>
      </span>
    </Link>
  );
}

const TICKER_ITEMS = [
  "Order online or on WhatsApp",
  "Door or locker delivery",
  "Delivered across South Africa",
  "T-shirts, jerseys, shorts and more",
  "Events and community",
];

export function Ticker() {
  return (
    <div className="ticker">
      <div className="ticker-track">
        <ul className="ticker-set">
          {TICKER_ITEMS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <ul className="ticker-set ticker-set-copy" aria-hidden="true">
          {TICKER_ITEMS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function firstSentence(text: string): string {
  const t = text.trim();
  const m = t.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return m ? m[0] : t;
}

/** The earliest upcoming event on a Mist band. Loads after mount; a failure or no event shows nothing. */
export function NextEvent() {
  const [event, setEvent] = useState<PublicEvent | null>(null);
  useEffect(() => {
    let live = true;
    listEvents()
      .then((list) => {
        if (!live || list.length === 0) return;
        setEvent([...list].sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!event) return null;

  const where = [event.venue, event.city].filter(Boolean).join(", ");
  const price = eventPriceLine(event);
  const facts: [string, string][] = [
    ["Date", formatEventDay(event.startsAt)],
    ["Doors", formatClock(event.startsAt)],
    ["Where", where],
    ["Tickets", price],
  ];
  return (
    <section className="gallery-section">
      <div className="band-tile next-event">
        <EventPoster event={event} />
        <div className="next-event-body">
          <h2 className="display h-sec">{event.title}</h2>
          {event.description && <p className="lede">{firstSentence(event.description)}</p>}
          <dl className="facts">
            {facts
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
          <div className="home-actions">
            <Link to={eventPath(event.slug)} className="cta">Get tickets</Link>
            <Link to="/events" className="cta cta-quiet">All events</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CategoryMosaic({ categories, products }: { categories: Category[]; products: Product[] }) {
  const tiles = categories
    .filter((c) => c.active !== false)
    .map((c) => {
      const mine = products.filter((p) => p.active !== false && p.category === c.id);
      return { cat: c, count: mine.length, image: mine.find((p) => p.image) };
    })
    .filter((t) => t.count > 0);
  const spans = categorySpans(tiles.length);
  return (
    <ul className="cat-mosaic">
      {tiles.map(({ cat, count, image }, i) => (
        <li key={cat.id} className={`cat-span-${spans[i]}`}>
          <Link to={categoryPath(cat.id)} className="cat-tile">
            <span className="cat-tile-img">
              <ProductImage src={image?.image} alt={image ? image.name : cat.name} />
            </span>
            <span className="cat-tile-cap">
              <span className="cat-tile-name">{cat.name}</span>
              <span className="cat-tile-count">{count === 1 ? "1 style" : `${count} styles`}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const STEPS = [
  ["Order online", "Pick your size and colour, place your order and follow it with a link. No account needed."],
  ["Or chat to order", "Prefer WhatsApp? Message us what you want and we sort it out. Same stock, same delivery."],
  ["Get it your way", "Door delivery or a locker near you, anywhere in South Africa."],
];

export function OrderYourWay() {
  return (
    <section className="gallery-section">
      <div className="band-tile">
        <h2 className="display h-sec">Click it or text it</h2>
        <ol className="steps">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="step">
              <span className="step-num" aria-hidden="true">{i + 1}</span>
              <h3 className="step-title">{title}</h3>
              <p className="lede">{text}</p>
            </li>
          ))}
        </ol>
        <div className="home-actions">
          <Link to="/shop" className="cta">Start shopping</Link>
          <a
            href={whatsappLink(`Hi ${shop.name}, I would like to place an order.`)}
            target="_blank"
            rel="noopener noreferrer"
            className="cta cta-quiet"
          >
            Order on WhatsApp
          </a>
        </div>
      </div>
    </section>
  );
}

/** Mailing-list sign-up beside a collage of gallery photos. The collage loads after mount and is dropped if empty. */
export function HearItFirst() {
  const [items, setItems] = useState<PublicGalleryItem[]>([]);
  useEffect(() => {
    let live = true;
    getGallery()
      .then((list) => {
        if (live) setItems(list.slice(0, 6));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className="gallery-section">
      <div className={`max-w-[1360px] mx-auto hear${items.length ? "" : " hear-solo"}`}>
        <div className="hear-copy">
          <h2 className="display h-sec">Hear it first</h2>
          <p className="lede">New drops, ticket releases and the odd after-party. Join the list and we let you know when something is on.</p>
          <SubscribeForm source="footer" />
          <Link to="/community" className="linkr">
            See the community
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
        {items.length > 0 && (
          <ul className="collage">
            {items.map((g, i) => (
              <li key={g.id} className={i === 0 || i === 4 ? "collage-big" : undefined}>
                <Link to="/community" className="collage-tile" aria-label={g.caption || "Photo from a 4Nguru event"}>
                  <ProductImage src={g.image} alt="" />
                  {g.caption && <span className="collage-cap">{g.caption}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
