import { useRef, useState } from "react";
import { Link } from "react-router";
import { clearCart, findVariant } from "../utils/storage";
import type { CartLine } from "../utils/storage";
import { ProductImage } from "./prism/ProductImage";
import { CheckoutPanel } from "./CheckoutPanel";
import { useCartQuote } from "./Cart";
import { useProducts } from "../hooks/useProducts";
import type { CartQuote } from "../api/types";

interface Snapshot {
  lines: CartLine[];
  quote: CartQuote | null;
}

export function Checkout() {
  const { lines, cartReady, quote, quoting, quoteError, linesKey, refreshCart, retry } = useCartQuote();
  const { products, loading: productsLoading, error: productsError, reload } = useProducts();
  const [orderPlaced, setOrderPlaced] = useState(false);
  // Once an order is saved the cart may be cleared (online payment). The page keeps showing the lines
  // and prices it was ordered with.
  const frozen = useRef<Snapshot>({ lines: [], quote: null });
  if (!orderPlaced) frozen.current = { lines, quote };
  const shown = orderPlaced ? frozen.current : { lines, quote };

  if (!cartReady) {
    return <div className="min-h-screen bg-paper" />;
  }

  if (shown.lines.length === 0) {
    return (
      <div className="min-h-screen bg-paper py-16 md:py-24">
        <div className="max-w-[1968px] mx-auto px-6 text-center">
          <p className="micro text-b60 mb-3">Your bag</p>
          <h1 className="display h-sec mb-6">Your cart is empty</h1>
          <p className="text-b60 mb-10">Add something to your cart before checking out.</p>
          <Link to="/shop" className="cta">Back to the shop</Link>
        </div>
      </div>
    );
  }

  const productsById = new Map(products.map((p) => [p.id, p]));
  const productsReady = !productsLoading && !productsError;
  const hasUnavailable =
    productsReady &&
    shown.lines.some((line) => {
      const product = productsById.get(line.productId);
      return !product || !findVariant(product, line.size, line.color);
    });
  const blocked = !shown.quote || quoting || hasUnavailable || shown.quote.missing.length > 0;
  const quoteLineFor = (line: CartLine) =>
    shown.quote?.lines.find(
      (q) => q.productId === line.productId && (q.size ?? "") === (line.size ?? "") && (q.color ?? "") === (line.color ?? "")
    );

  const handleCartCleared = () => {
    clearCart();
    refreshCart();
    window.dispatchEvent(new Event("cartUpdated"));
  };

  return (
    <div className="min-h-screen bg-paper py-12 md:py-16">
      <div className="max-w-3xl mx-auto px-6">
        <p className="micro text-b60 mb-3">Your bag</p>
        <h1 className="display h-sec mb-8">Checkout</h1>

        <p className="micro text-b60 mb-3">Your order</p>
        <div className="border-t border-b10 mb-10">
          {shown.lines.map((line, index) => {
            const product = productsById.get(line.productId);
            const q = quoteLineFor(line);
            return (
              <div key={`${line.productId}-${index}`} className="flex gap-4 py-4 border-b border-b10">
                <div className="w-16 h-16 shrink-0 bg-b5 overflow-hidden r-card">
                  <ProductImage src={product?.image ?? q?.image} alt={q?.name ?? product?.name ?? "Item"} seed={line.productId} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-display h-weight h-case h-track-sm break-words">{q?.name ?? product?.name ?? "Loading…"}</p>
                  <p className="micro text-b60">
                    {[line.size && `Size: ${line.size}`, line.color && `Color: ${line.color}`, `Qty: ${line.quantity}`]
                      .filter(Boolean)
                      .join(" | ")}
                  </p>
                </div>
                <p className="font-mono shrink-0">{q ? `R${q.subtotal.toFixed(2)}` : "-"}</p>
              </div>
            );
          })}
        </div>
        {quoting && <p className="micro text-b60 mb-4">Updating prices…</p>}
        {quoteError && (
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <p className="text-sm text-prism">{quoteError}</p>
            <button type="button" onClick={retry} className="linkr">Try again</button>
          </div>
        )}
        {shown.quote && shown.quote.missing.length > 0 && !orderPlaced && (
          <p className="text-sm text-prism mb-4">
            Some items are no longer available. <Link to="/cart" className="linkr">Edit your cart</Link>
          </p>
        )}
        {hasUnavailable && !orderPlaced && (
          <p className="text-sm text-prism mb-4">
            An item in your cart is no longer available. <Link to="/cart" className="linkr">Edit your cart</Link>
          </p>
        )}
        {orderPlaced ? (
          <p className="micro text-b60 mb-6">Order saved. Your cart is locked until you confirm it was sent.</p>
        ) : (
          <p className="mb-6"><Link to="/cart" className="linkr">Edit cart</Link></p>
        )}

        <CheckoutPanel
          items={JSON.parse(linesKey)}
          blocked={blocked}
          onStockShort={() => { reload().catch(() => {}); }}
          onCartCleared={handleCartCleared}
          onOrderChange={setOrderPlaced}
          itemsTotal={shown.quote ? shown.quote.total : undefined}
        />
      </div>
    </div>
  );
}
