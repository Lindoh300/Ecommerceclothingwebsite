import type { Variant } from "../api/types";

// At or below this a cell counts as low stock (the shop shows "Only N left" at the same level).
export const LOW_STOCK_CELL = 3;

interface AdminStockGridProps {
  variants: Variant[];
  /** Typed value per variant id; text so a field can be empty while typing. */
  values: Record<string, string>;
  /** What the server last said, per variant id. Changed cells are marked. */
  baseline: Record<string, number>;
  disabled?: boolean;
  onChange: (variantId: string, value: string) => void;
}

/** A typed value as a whole number of 0 or more, or null if it is not one. */
export const parseStock = (text: string): number | null => {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
};

const unique = (list: string[]) => [...new Set(list)];

export function AdminStockGrid({ variants, values, baseline, disabled, onChange }: AdminStockGridProps) {
  const sizes = unique(variants.map((v) => v.size));
  const colors = unique(variants.map((v) => v.color));
  const cell = (size: string, color: string) => variants.find((v) => v.size === size && v.color === color);
  const amount = (v: Variant) => parseStock(values[v.id] ?? "") ?? 0;
  const label = (text: string) => text || "Any";

  const rowTotal = (color: string) => variants.filter((v) => v.color === color).reduce((n, v) => n + amount(v), 0);
  const colTotal = (size: string) => variants.filter((v) => v.size === size).reduce((n, v) => n + amount(v), 0);
  const total = variants.reduce((n, v) => n + amount(v), 0);
  const changed = variants.filter((v) => parseStock(values[v.id] ?? "") !== baseline[v.id]).length;

  if (variants.length === 0) {
    return <p className="text-b60">This product has no variants yet.</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <p className="micro text-b60">Stock by size and colour</p>
        <p className="font-mono text-sm text-ink">
          Total {total}
          {changed > 0 && <span className="text-prism"> · {changed} changed</span>}
        </p>
      </div>
      {/* Scrolls inside this box so a wide grid never widens the page. */}
      <div className="border border-b10 r-card overflow-x-auto max-w-full">
        <table className="text-left border-collapse min-w-max">
          <thead>
            <tr className="border-b border-b10">
              <th scope="col" className="px-3 py-2 font-normal micro text-b60 sticky left-0 bg-paper">
                Colour / Size
              </th>
              {sizes.map((size) => (
                <th key={size} scope="col" className="px-2 py-2 font-normal micro text-b60 text-center">
                  {label(size)}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 font-normal micro text-b60 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-b10">
            {colors.map((color) => (
              <tr key={color}>
                <th scope="row" className="px-3 py-2 font-normal text-ink whitespace-nowrap sticky left-0 bg-paper">
                  {label(color)}
                </th>
                {sizes.map((size) => {
                  const v = cell(size, color);
                  if (!v) {
                    return <td key={size} className="px-2 py-2 text-center text-b60" aria-label="No variant">-</td>;
                  }
                  const n = parseStock(values[v.id] ?? "");
                  const zero = n === 0;
                  const low = n !== null && n > 0 && n <= LOW_STOCK_CELL;
                  const state = n === null ? "invalid" : zero ? "out of stock" : low ? "low stock" : "";
                  return (
                    <td key={size} className="px-2 py-2">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={values[v.id] ?? ""}
                        disabled={disabled}
                        aria-label={`Stock for ${label(color)}, ${label(size)}${state ? `, ${state}` : ""}`}
                        aria-invalid={n === null}
                        onChange={(e) => onChange(v.id, e.target.value)}
                        className={`w-16 h-9 px-2 text-center font-mono border outline-none focus-visible:border-ink ${
                          n === null
                            ? "border-status-low text-status-low bg-paper"
                            : zero
                              ? "border-b10 bg-b10 text-b60 line-through"
                              : low
                                ? "border-status-low text-status-low bg-paper"
                                : "border-b10 text-ink bg-paper"
                        } ${parseStock(values[v.id] ?? "") !== baseline[v.id] ? "font-bold" : ""}`}
                      />
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right font-mono text-ink">{rowTotal(color)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-b10">
              <th scope="row" className="px-3 py-2 font-normal micro text-b60 sticky left-0 bg-paper">Total</th>
              {sizes.map((size) => (
                <td key={size} className="px-2 py-2 text-center font-mono text-ink">{colTotal(size)}</td>
              ))}
              <td className="px-3 py-2 text-right font-mono text-ink">{total}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="micro text-b60 mt-2">
        Grey and struck through: out of stock. Highlighted outline: {LOW_STOCK_CELL} or fewer. Bold: changed.
      </p>
    </div>
  );
}
