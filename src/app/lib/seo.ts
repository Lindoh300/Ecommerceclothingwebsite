// Page metadata for link previews (WhatsApp, Instagram) and the browser tab.
// Pure functions, safe on the server and the client. A route's `meta` replaces its parents',
// so every page builds the full set of tags here.
import type { Product } from "../api/types";
import { shop } from "../config/shop";

export const SITE_NAME = "4Nguru";
export const SITE_TITLE = "4Nguru The Brand Online";
export const SITE_DESCRIPTION =
  "South African clothing brand. T-shirts, jerseys, shorts, pants and accessories. Shop online or order on WhatsApp.";
export const OG_FALLBACK_IMAGE = "/images/og-default.png";
// The site has been noindex since the Figma Make export (index.html). Kept as is; removing it is
// the owner's call.
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

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max);
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
  if (LEGACY_LABELS[id]) return LEGACY_LABELS[id];
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
  const description = truncate(product.description || `${product.name} from 4Nguru The Brand Online.`, 160);
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

/** The site origin the root loader returned, found among a route's `matches`. */
export function originFromMatches(matches: ReadonlyArray<{ id: string; data?: unknown } | undefined>): string {
  const root = matches.find((m) => m?.id === "root");
  return (root?.data as { origin?: string } | undefined)?.origin ?? "";
}
