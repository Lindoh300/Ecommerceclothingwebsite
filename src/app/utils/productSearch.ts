import type { Product } from "../api/types";

/**
 * True when every word in the query appears in the product's name, description,
 * category name or colours. Case-insensitive; an empty query matches everything.
 */
export function matchesQuery(product: Product, query: string, categoryName = ""): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = [product.name, product.description, categoryName, ...(product.colors ?? [])].join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}
