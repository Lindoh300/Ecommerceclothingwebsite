// Page metadata for link previews (WhatsApp, Instagram) and the browser tab.
// Pure functions, safe on the server and the client. A route's `meta` replaces its parents',
// so every page builds the full set of tags here.
import type { Product, PublicEvent } from "../api/types";
import { shop } from "../config/shop";
import { formatEventDate } from "../utils/eventTime";

export const SITE_NAME = "4Nguru";
export const SITE_TITLE = "4Nguru The Brand Online";
export const SITE_DESCRIPTION =
  "South African clothing brand. T-shirts, jerseys, shorts, pants and accessories. Shop online or order on WhatsApp.";
export const OG_FALLBACK_IMAGE = "/images/og-default.png";
// The site is noindex for now. Kept as is; removing it is the owner's call.
export const ROBOTS = "noindex, nofollow";

type MetaDescriptor = Record<string, string>;

/** Origin (scheme and host) of a request, for absolute URLs. Behind a proxy the scheme comes from x-forwarded-proto. */
export function originOf(request: Request): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto === "https" && url.protocol === "http:") url.protocol = "https:";
  return url.origin;
}

export function absoluteUrl(origin: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${origin}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

/** Whitespace collapsed and trimmed, cut to at most `max` UTF-16 units. A cut never splits a surrogate pair (an emoji). */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  // If the cut would land on a low surrogate, its high surrogate would be left alone, so cut one unit earlier.
  const low = /[\uDC00-\uDFFF]/.test(clean.charAt(max));
  return clean.slice(0, low ? max - 1 : max);
}

interface PageMetaInput {
  origin: string;
  title: string;
  description: string;
  /** Path (e.g. "/tshirts") or absolute URL, used for og:url. */
  path: string;
  image?: string;
  type?: string;
  noindex?: boolean;
  canonical?: string;
  extra?: MetaDescriptor[];
}

export function pageMeta(input: PageMetaInput): MetaDescriptor[] {
  const { origin, title, description, path } = input;
  const url = absoluteUrl(origin, path);
  const image = absoluteUrl(origin, input.image || OG_FALLBACK_IMAGE);
  const tags: MetaDescriptor[] = [
    { title },
    { name: "description", content: description },
    { name: "robots", content: input.noindex ? "noindex, nofollow" : ROBOTS },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: input.type ?? "website" },
    { property: "og:url", content: url },
    { property: "og:image", content: image },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
  ];
  if (input.canonical) tags.push({ tagName: "link", rel: "canonical", href: absoluteUrl(origin, input.canonical) });
  if (input.extra) tags.push(...input.extra);
  return tags;
}

export function defaultMeta(origin: string, path = "/"): MetaDescriptor[] {
  return pageMeta({ origin, title: SITE_TITLE, description: SITE_DESCRIPTION, path });
}

export function homeMeta(origin: string): MetaDescriptor[] {
  return pageMeta({
    origin,
    title: `${SITE_TITLE} | Clothing`,
    description: `Shop 4Nguru clothing online and order on WhatsApp. Delivery across South Africa. Call or WhatsApp ${shop.phone}.`,
    path: "/",
    canonical: "/",
  });
}

const LEGACY_LABELS: Record<string, string> = {
  tshirts: "T-Shirts",
  jerseys: "Jerseys",
  shorts: "Shorts",
  pants: "Pants",
  accessories: "Accessories",
};

/** A readable name for a category id. The real name is loaded in the browser; this is for the head only. */
export function categoryLabel(id: string): string {
  // Own keys only: a plain object would otherwise hand back inherited members such as "constructor".
  if (Object.hasOwn(LEGACY_LABELS, id)) return LEGACY_LABELS[id];
  const spaced = id.replace(/[-_]+/g, " ").trim();
  return spaced.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function categoryMeta(origin: string, id: string, path: string): MetaDescriptor[] {
  const label = categoryLabel(id);
  return pageMeta({
    origin,
    title: `${label} | 4Nguru`,
    description: `Shop ${label} from 4Nguru The Brand Online. Order on WhatsApp, delivery across South Africa.`,
    path,
    canonical: path,
  });
}

export function productPath(product: Pick<Product, "id" | "slug">): string {
  return `/product/${encodeURIComponent(product.slug || product.id)}`;
}

export function productMeta(origin: string, product: Product): MetaDescriptor[] {
  const path = productPath(product);
  const image = product.images?.find(Boolean) || product.image || undefined;
  // A blank or whitespace-only description uses the same fallback as a missing one.
  const own = product.description?.trim() ? product.description : `${product.name} from 4Nguru The Brand Online.`;
  const description = truncate(own, 160);
  return pageMeta({
    origin,
    title: `${product.name} | 4Nguru`,
    description,
    path,
    image,
    type: "product",
    canonical: path,
    extra: [
      { property: "product:price:amount", content: product.price.toFixed(2) },
      { property: "product:price:currency", content: "ZAR" },
    ],
  });
}

export function eventPath(slug: string): string {
  return `/event/${encodeURIComponent(slug)}`;
}

/** Head for an event page: the title, "date at venue, city" plus the description, and the event image. */
export function eventMeta(origin: string, event: PublicEvent): MetaDescriptor[] {
  const path = eventPath(event.slug);
  const where = [event.venue, event.city].filter(Boolean).join(", ");
  const when = [formatEventDate(event.startsAt), where].filter(Boolean).join(" at ");
  const description = truncate(
    [when, event.description].filter(Boolean).join(". ") || `${event.title} from 4Nguru The Brand Online.`,
    160,
  );
  return pageMeta({
    origin,
    title: `${event.title} | 4Nguru`,
    description,
    path,
    image: event.image || undefined,
    canonical: path,
  });
}

/** The site origin the root loader returned, found among a route's `matches`. */
export function originFromMatches(matches: ReadonlyArray<{ id: string; data?: unknown } | undefined>): string {
  const root = matches.find((m) => m?.id === "root");
  return (root?.data as { origin?: string } | undefined)?.origin ?? "";
}
