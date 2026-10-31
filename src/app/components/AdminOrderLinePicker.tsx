import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import type { Product, Variant } from "../api/types";

/** Most units of one variant on one line, and most lines: the server's limits. */
export const MAX_LINE_QUANTITY = 50;
export const MAX_LINES = 20;

const SHOWN_RESULTS = 8;

export const variantLabel = (v: Pick<Variant, "size" | "color">): string =>
  [v.size, v.color].filter(Boolean).join(" · ") || "Standard";

interface AdminOrderLinePickerProps {
  /** Active products only, with live stock. */
  products: Product[];
  /** Adds (or tops up) a line for this variant. Returns false when it was refused, so the picker keeps its input. */
  onAdd: (product: Product, variant: Variant, quantity: number) => boolean;
}

/**
 * Find a product, choose its size and colour, set a quantity and add it as a line. Mobile first: one column, large
 * touch targets, and the live stock is beside every choice.
 */
export function AdminOrderLinePicker({ products, onAdd }: AdminOrderLinePickerProps) {
  const [query, setQuery] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [problem, setProblem] = useState<string | null>(null);

  // The picked product is looked up again on every render, so a stock reload shows through.
  const product = products.find((p) => p.id === productId) ?? null;
  const variant = product?.variants.find((v) => v.id === variantId) ?? null;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || p.variants.some((v) => v.sku.toLowerCase().includes(q)),
    );
  }, [products, query]);

  const pick = (p: Product) => {
    setProductId(p.id);
    // One choice only? Choose it for them.
    const inStock = p.variants.filter((v) => v.stock > 0);
    setVariantId(p.variants.length === 1 ? p.variants[0].id : inStock.length === 1 ? inStock[0].id : "");
    setQuantity("1");
    setProblem(null);
  };

  const clear = () => {
    setProductId(null);
    setVariantId("");
    setQuantity("1");
    setQuery("");
    setProblem(null);
  };

  const add = () => {
    if (!product || !variant) {
      setProblem("Choose a product and its size and colour first.");
      return;
    }
    const n = Number(quantity);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LINE_QUANTITY) {
      setProblem(`Quantity must be a whole number from 1 to ${MAX_LINE_QUANTITY}.`);
      return;
    }
    if (onAdd(product, variant, n)) clear();
  };

  return (
    <div className="border border-b10 r-card p-4 space-y-4">
      {!product ? (
        <div>
          <Label htmlFor="line-search">Find a product</Label>
          <div className="relative mt-1">
            <Search className="w-4 h-4 text-b60 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              id="line-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or SKU"
              autoComplete="off"
              className="pl-9 h-11 md:h-9"
            />
          </div>
          {query.trim() !== "" && results.length === 0 && (
            <p className="text-sm text-b60 mt-2">No product matches "{query.trim()}".</p>
          )}
          {results.length > 0 && (
            <ul className="mt-2 border border-b10 divide-y divide-b10 r-card overflow-hidden">
              {results.slice(0, SHOWN_RESULTS).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => pick(p)}
                    className="w-full text-left px-3 py-3 flex items-baseline justify-between gap-3 hover:bg-b5 focus-visible:bg-b5 outline-none"
                  >
                    <span className="min-w-0 text-ink break-words">{p.name}</span>
                    <span className="text-sm text-b60 shrink-0">
                      R{p.price} · {p.stock} in stock
                    </span>
                  </button>
                </li>
              ))}
              {results.length > SHOWN_RESULTS && (
                <li className="px-3 py-2 text-sm text-b60">{results.length - SHOWN_RESULTS} more: type more to narrow.</li>
              )}
            </ul>
          )}
          {query.trim() === "" && products.length > 0 && (
            <p className="text-sm text-b60 mt-2">{products.length} active products. Type to search.</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-ink break-words">{product.name}</div>
              <div className="text-sm text-b60">R{product.price}</div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={clear}>
              Change
            </Button>
          </div>
          <div>
            <Label htmlFor="line-variant">Size and colour</Label>
            <Select value={variantId} onValueChange={setVariantId}>
              <SelectTrigger id="line-variant" className="mt-1 h-11 md:h-9">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {product.variants.map((v) => (
                  <SelectItem key={v.id} value={v.id} disabled={v.stock <= 0}>
                    {variantLabel(v)} — {v.stock <= 0 ? "sold out" : `${v.stock} left`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {variant && (
              <p className={`text-sm mt-1 ${variant.stock <= 3 ? "text-status-low" : "text-b60"}`}>
                {variant.stock} in stock · SKU {variant.sku}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="line-quantity">Quantity</Label>
            <Input
              id="line-quantity"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_LINE_QUANTITY}
              step={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="mt-1 h-11 md:h-9 w-28"
            />
          </div>
          <Button type="button" onClick={add} className="w-full sm:w-auto min-h-11 md:min-h-9">
            <Plus className="w-4 h-4 mr-2" />
            Add to order
          </Button>
        </>
      )}
      {problem && (
        <p role="alert" className="text-sm text-status-low">
          {problem}
        </p>
      )}
    </div>
  );
}
