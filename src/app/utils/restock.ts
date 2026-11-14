import type { RestockRequest } from "../api/types";

type Option = Pick<RestockRequest, "size" | "color">;
type Message = Option & Pick<RestockRequest, "productName">;

/** "M / Black", or just the size or colour the product has. */
export const restockOption = (r: Option): string => [r.size, r.color].filter(Boolean).join(" / ");

/** What the owner sends to someone waiting for a restock. */
export function buildRestockMessage(r: Message, productUrl: string): string {
  const option = restockOption(r);
  return `Hi, the ${r.productName}${option ? ` (${option})` : ""} you asked about is back in stock at 4Nguru: ${productUrl}`;
}

/** A mailto: link with the same message, for a customer who left an email address. */
export function restockMailto(r: Message & Pick<RestockRequest, "email">, productUrl: string): string {
  return `mailto:${r.email ?? ""}?subject=${encodeURIComponent(`Back in stock: ${r.productName}`)}&body=${encodeURIComponent(buildRestockMessage(r, productUrl))}`;
}
