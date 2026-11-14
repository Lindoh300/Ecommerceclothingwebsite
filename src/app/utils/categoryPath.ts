// Categories that already have their own route in routes.tsx (kept so old links work).
export const LEGACY_CATEGORY_IDS = ["tshirts", "jerseys", "shorts", "pants", "accessories"] as const;

// Link to a category page: the legacy path when there is one, otherwise category/:id.
export const categoryPath = (id: string): string =>
  (LEGACY_CATEGORY_IDS as readonly string[]).includes(id) ? `/${id}` : `/category/${encodeURIComponent(id)}`;
