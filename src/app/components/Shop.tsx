import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { SlidersHorizontal } from "lucide-react";
import type { Product } from "../api/types";
import { useProducts } from "../hooks/useProducts";
import { useCategories } from "../hooks/useCategories";
import { shop, whatsappLink } from "../config/shop";
import { isGallery } from "../config/theme";
import { matchesQuery } from "../utils/productSearch";
import { LoadState } from "./common";
import { ProductGrid } from "./ProductGrid";
import { ProductSearch } from "./ProductSearch";

type Sort = "newest" | "price-asc" | "price-desc";

const SORTS: { value: Sort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
];

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];

const sizeRank = (s: string) => {
  const i = SIZE_ORDER.indexOf(s.toUpperCase());
  return i === -1 ? SIZE_ORDER.length : i;
};

const sortSizes = (a: string, b: string) => sizeRank(a) - sizeRank(b) || a.localeCompare(b, "en");

interface Filters {
  category: string;
  size: string;
  color: string;
  inStock: boolean;
  sort: Sort;
  q: string;
}

function readFilters(params: URLSearchParams): Filters {
  const sort = params.get("sort");
  return {
    category: params.get("category") ?? "",
    size: params.get("size") ?? "",
    color: params.get("color") ?? "",
    inStock: params.get("stock") === "1",
    q: params.get("q") ?? "",
    sort: SORTS.some((s) => s.value === sort) ? (sort as Sort) : "newest",
  };
}

/** Variants that match the chosen size and colour (a missing choice matches any). */
function matchingVariants(p: Product, size: string, color: string) {
  return (p.variants ?? []).filter((v) => (!size || v.size === size) && (!color || v.color === color));
}

function matches(p: Product, f: Filters): boolean {
  if (f.category && p.category !== f.category) return false;
  const hasVariants = (p.variants ?? []).length > 0;
  if (f.size || f.color) {
    if (hasVariants) {
      const found = matchingVariants(p, f.size, f.color);
      if (found.length === 0) return false;
      if (f.inStock && !found.some((v) => v.stock > 0)) return false;
      return true;
    }
    if (f.size && !p.sizes.includes(f.size)) return false;
    if (f.color && !p.colors.includes(f.color)) return false;
  }
  if (f.inStock && p.stock <= 0) return false;
  return true;
}

function sortProducts(list: Product[], sort: Sort): Product[] {
  const copy = [...list];
  if (sort === "price-asc") return copy.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name, "en"));
  if (sort === "price-desc") return copy.sort((a, b) => b.price - a.price || a.name.localeCompare(b.name, "en"));
  return copy.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.name.localeCompare(b.name, "en")));
}

const chipClass = (selected: boolean) =>
  `r-chip min-h-[40px] max-w-full break-words px-4 py-2 border text-sm transition-colors motion-reduce:transition-none ${
    selected ? "bg-ink text-paper border-ink" : "bg-paper text-ink border-b10 hover:border-ink"
  }`;

function ChipGroup({
  label,
  options,
  value,
  onChange,
  allLabel,
}: {
  label: string;
  options: { value: string; label: string; count?: number }[];
  value: string;
  onChange: (next: string) => void;
  /** Adds a first chip with this label that is pressed when nothing is chosen and clears the choice. */
  allLabel?: { label: string; count?: number };
}) {
  if (options.length === 0) return null;
  const count = (n?: number) => (n === undefined ? null : <span className="shop-chip-count"> {n}</span>);
  return (
    <div role="group" aria-label={label} className="shop-filter-row">
      <p className="micro text-b60 mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {allLabel && (
          <button
            type="button"
            aria-pressed={value === ""}
            onClick={() => onChange("")}
            className={chipClass(value === "")}
          >
            {allLabel.label}
            {count(allLabel.count)}
          </button>
        )}
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(value === o.value ? "" : o.value)}
            className={chipClass(value === o.value)}
          >
            {o.label}
            {count(o.count)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Shop() {
  const [params, setParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { products: allProducts, loading: productsLoading, error: productsError, reload } = useProducts();
  const { categories } = useCategories();
  const f = readFilters(params);

  const products = useMemo(() => allProducts.filter((p) => p.active !== false), [allProducts]);

  // Choices come from the products themselves.
  const sizes = useMemo(() => [...new Set(products.flatMap((p) => p.sizes ?? []))].sort(sortSizes), [products]);
  const colors = useMemo(() => [...new Set(products.flatMap((p) => p.colors ?? []))].sort((a, b) => a.localeCompare(b, "en")), [products]);
  const categoryOptions = useMemo(() => {
    const used = new Set(products.map((p) => p.category));
    const counts = new Map<string, number>();
    for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    return categories
      .filter((c) => c.active !== false && used.has(c.id))
      .map((c) => ({ value: c.id, label: c.name, count: counts.get(c.id) ?? 0 }));
  }, [categories, products]);

  const categoryNames = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const visible = useMemo(
    () => sortProducts(products.filter((p) => matches(p, f) && matchesQuery(p, f.q, categoryNames.get(p.category) ?? "")), f.sort),
    [products, f.category, f.size, f.color, f.inStock, f.q, f.sort, categoryNames],
  );

  const activeCount = [f.category, f.size, f.color].filter(Boolean).length + (f.inStock ? 1 : 0) + (f.q.trim() ? 1 : 0);

  const update = (changes: Partial<Record<"q" | "category" | "size" | "color" | "stock" | "sort", string>>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (!value || (key === "sort" && value === "newest")) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const clear = () => setParams(new URLSearchParams(f.sort === "newest" ? undefined : { sort: f.sort }), { replace: true, preventScrollReset: true });

  const categoryName = categories.find((c) => c.id === f.category)?.name ?? f.category;
  const activeSummary = [f.q.trim() && `"${f.q.trim()}"`, f.category && categoryName, f.size && `size ${f.size}`, f.color, f.inStock && "in stock"]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="min-h-screen bg-paper py-12 md:py-16">
      <div className="max-w-[1360px] mx-auto px-6">
        <h1 className="display h-sec mb-4">All products</h1>
        <p className="page-sub mb-10">
          T-shirts, jerseys, shorts and more. Sizes that are sold out in a colour are marked on the product page.
        </p>

        {isGallery && (
          <div className="mb-8">
            <ProductSearch value={f.q} onValueChange={(v) => update({ q: v })} />
          </div>
        )}

        <LoadState loading={productsLoading} error={productsError} onRetry={() => reload().catch(() => {})}>
          {isGallery && (
            <button
              type="button"
              className="cta cta-quiet shop-filters-toggle"
              aria-expanded={filtersOpen}
              aria-controls="shop-filters"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              Filters{activeCount > 0 ? ` (${activeCount})` : ""}
            </button>
          )}
          <div
            id="shop-filters"
            data-open={filtersOpen}
            className="shop-filters mb-10 flex flex-col gap-6 border-y border-b10 py-6"
            role="search"
            aria-label="Filter products"
          >
            <ChipGroup
              label="Category"
              options={categoryOptions}
              value={f.category}
              onChange={(v) => update({ category: v })}
              allLabel={{ label: "All", count: products.length }}
            />
            <ChipGroup label="Size" options={sizes.map((s) => ({ value: s, label: s }))} value={f.size} onChange={(v) => update({ size: v })} />
            <ChipGroup label="Colour" options={colors.map((c) => ({ value: c, label: c }))} value={f.color} onChange={(v) => update({ color: v })} />
            <div className="shop-filter-last">
              <div className="shop-sort">
                <label htmlFor="shop-sort" className="micro text-b60 mb-2 block">Sort</label>
                <select
                  id="shop-sort"
                  value={f.sort}
                  onChange={(e) => update({ sort: e.target.value })}
                  className="r-chip h-10 w-full border border-b10 bg-paper px-3 text-sm text-ink"
                >
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <label className="flex min-h-[40px] cursor-pointer items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={f.inStock}
                  onChange={(e) => update({ stock: e.target.checked ? "1" : "" })}
                  className="h-5 w-5 accent-[var(--brand)]"
                />
                In stock only
              </label>
              {activeCount > 0 && (
                <button type="button" onClick={clear} className="linkr text-ink">
                  Clear filters ({activeCount})
                </button>
              )}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="r-card border border-b10 p-8 text-center md:p-12">
              <h2 className="display h-mid mb-4">Nothing matches</h2>
              <p className="mx-auto mb-8 max-w-prose text-b60">
                {activeCount > 0
                  ? `No products for ${activeSummary}. Loosen a filter, or ask us on WhatsApp.`
                  : "There are no products to show right now. Check back soon, or ask us on WhatsApp."}
              </p>
              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                {activeCount > 0 && (
                  <button type="button" onClick={clear} className="cta">Clear filters</button>
                )}
                <a
                  href={whatsappLink(`Hi ${shop.name}, I am looking for something${activeSummary ? ` (${activeSummary})` : ""}.`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="linkr text-ink"
                >
                  Ask on WhatsApp
                </a>
              </div>
            </div>
          ) : (
            <>
              <p className="micro text-b60 mb-4" role="status">
                {visible.length} {visible.length === 1 ? "product" : "products"}
              </p>
              <ProductGrid products={visible} />
            </>
          )}
        </LoadState>
      </div>
    </div>
  );
}
