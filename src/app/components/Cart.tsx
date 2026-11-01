import { useState, useEffect, useRef } from "react";
import { Link } from "react-router";
import type { CartLine } from "../utils/storage";
import { getCart, removeFromCart, updateCartItem, findVariant, getVariantStock } from "../utils/storage";
import { toast } from "../lib/toast";
import { ProductImage } from "./common/ProductImage";
import { useProducts } from "../hooks/useProducts";
import { quoteCart } from "../api/products";
import type { CartQuote } from "../api/types";

/** The cart lines (read after mount) and their server quote. Shared by the cart and the checkout. */
export function useCartQuote() {
  // The cart lives in the browser. It is read after mount, so the server and the first client
  // render both show the same neutral page and hydration matches.
  const [lines, setLines] = useState<CartLine[]>([]);
  const [cartReady, setCartReady] = useState(false);
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const requestId = useRef(0);

  const refreshCart = () => {
    setLines(getCart());
  };

  useEffect(() => {
    refreshCart();
    setCartReady(true);
    window.addEventListener("cartUpdated", refreshCart);
    return () => window.removeEventListener("cartUpdated", refreshCart);
  }, []);

  const linesKey = JSON.stringify(
    lines.map(({ productId, size, color, quantity }) => ({ productId, size, color, quantity }))
  );

  useEffect(() => {
    const items = JSON.parse(linesKey) as Parameters<typeof quoteCart>[0];
    const id = ++requestId.current;
    if (items.length === 0) {
      setQuote(null);
      setQuoting(false);
      setQuoteError(null);
      return;
    }
    setQuoting(true);
    setQuoteError(null);
    const timer = setTimeout(() => {
      quoteCart(items)
        .then((result) => {
          if (id !== requestId.current) return;
          setQuote(result);
          setQuoting(false);
        })
        .catch((err: unknown) => {
          if (id !== requestId.current) return;
          setQuote(null);
          setQuoting(false);
          setQuoteError(err instanceof Error ? err.message : "Could not update prices");
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [linesKey, retryCount]);

  const retry = () => setRetryCount((n) => n + 1);
  return { lines, cartReady, quote, quoting, quoteError, linesKey, refreshCart, retry };
}

export function Cart() {
  const { lines, cartReady, quote, quoting, quoteError, linesKey, refreshCart, retry } = useCartQuote();
  const { products, loading: productsLoading, error: productsError } = useProducts();

  const productsById = new Map(products.map((p) => [p.id, p]));
  const productsReady = !productsLoading && !productsError;
  // Gone product, or a variant (size and colour) that no longer exists.
  const isUnavailable = (line: CartLine) => {
    if (!productsReady) return false;
    const product = productsById.get(line.productId);
    return !product || !findVariant(product, line.size, line.color);
  };
  const hasUnavailable = lines.some(isUnavailable);
  // Units of this line's variant that can be bought: the quote's figure, else the loaded product's.
  const availableFor = (line: CartLine): number => {
    const quoted = quote?.lines.find(
      (q) => q.productId === line.productId && (q.size ?? "") === (line.size ?? "") && (q.color ?? "") === (line.color ?? "")
    );
    return quoted ? quoted.available : getVariantStock(line.productId, line.size, line.color);
  };
  // Units of this line's variant in the cart, all lines on it.
  const quantityInCart = (line: CartLine): number =>
    lines.reduce(
      (sum, l) =>
        l.productId === line.productId && (l.size ?? "") === (line.size ?? "") && (l.color ?? "") === (line.color ?? "")
          ? sum + l.quantity
          : sum,
      0,
    );
  const total = quote?.total ?? 0;
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);
  // The server's line for a cart line (name, unit price), once the quote has it.
  const quoteLineFor = (line: CartLine) =>
    quote?.lines.find(
      (q) => q.productId === line.productId && (q.size ?? "") === (line.size ?? "") && (q.color ?? "") === (line.color ?? "")
    );
  const blocked = !quote || quoting || hasUnavailable || quote.missing.length > 0;

  const handleUpdateQuantity = (index: number, quantity: number) => {
    if (quantity < 1) return;
    const updated = updateCartItem(index, quantity);
    if (!updated) {
      const line = lines[index];
      const option = [line.size, line.color].filter(Boolean).join(", ");
      toast.error('Not enough stock', {
        description: `Only ${availableFor(line)} available${option ? ` in ${option}` : ""}.`
      });
      return;
    }
    refreshCart();
    window.dispatchEvent(new Event('cartUpdated'));
  };

  const handleRemove = (index: number) => {
    removeFromCart(index);
    refreshCart();
    window.dispatchEvent(new Event('cartUpdated'));
  };

  if (!cartReady) {
    return <div className="min-h-screen bg-paper" />;
  }

  if (lines.length === 0) {
    return (
      <div className="min-h-screen bg-paper py-16 md:py-24">
        <div className="max-w-[1360px] mx-auto px-6">
          <p className="page-kicker micro text-b60 mb-3">Your bag</p>
          <h2 className="display h-sec mb-6">Your cart is empty</h2>
          <p className="text-b60 mb-10">Nothing here yet. Pick a colour and size to get started.</p>
          <div className="flex flex-wrap gap-3">
            <Link to="/shop" className="cta">Shop now</Link>
            <Link to="/events" className="cta cta-quiet">See events</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper py-12 md:py-16">
      <div className="max-w-[1360px] mx-auto px-6">
        <p className="page-kicker micro text-b60 mb-3">Your bag</p>
        <h1 className="display h-sec mb-3">Your cart</h1>
        <p className="page-sub mb-10">{`${itemCount} ${itemCount === 1 ? "item" : "items"}. Check sizes and quantities, then check out as a guest.`}</p>

        <div className="grid lg:grid-cols-3 gap-10 lg:gap-16">
          {/* Cart Items */}
          <div className="lg:col-span-2">
            <div className="border-t border-b10">
              {lines.map((item, index) => {
                const product = productsById.get(item.productId);
                const unavailable = isUnavailable(item);
                const q = quoteLineFor(item);
                const name = product?.name ?? (unavailable ? "Unavailable item" : "Loading…");
                return (
                <div key={`${item.productId}-${index}`} className="flex gap-6 py-6 border-b border-b10">
                  <div className="w-24 h-24 shrink-0 bg-b5 overflow-hidden r-card">
                    <ProductImage src={product?.image} alt={product?.name ?? "Unavailable item"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display h-weight h-case h-track-sm mb-1">
                      {product ? (
                        <Link to={`/product/${item.productId}`} className="hover:underline underline-offset-4">{product.name}</Link>
                      ) : (
                        name
                      )}
                    </h3>
                    <p className="micro text-b60 mb-2">
                      {item.size && `Size: ${item.size}`}
                      {item.size && item.color && ' | '}
                      {item.color && `Color: ${item.color}`}
                    </p>
                    {unavailable ? (
                      <p className="text-brand">No longer available</p>
                    ) : product ? (
                      <p className="text-ink">R{product.price} each</p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleUpdateQuantity(index, item.quantity - 1)}
                          aria-label="Decrease quantity"
                          className="w-8 h-8 border border-b10 r-chip text-ink hover:border-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          -
                        </button>
                        <span className="w-8 text-center">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => handleUpdateQuantity(index, item.quantity + 1)}
                          disabled={unavailable || quantityInCart(item) >= availableFor(item)}
                          aria-label="Increase quantity"
                          className="w-8 h-8 border border-b10 r-chip text-ink hover:border-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          +
                        </button>
                      </div>
                      <button type="button" onClick={() => handleRemove(index)} aria-label={`Remove ${name}`} className="linkr">
                        Remove
                      </button>
                      {q && <span className="ml-auto text-ink">R{(q.price * item.quantity).toFixed(2)}</span>}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </div>

          {/* Order Summary */}
          <div className="lg:col-span-1">
            <div className="border border-b10 r-card p-6 sticky top-24">
              <h2 className="display h-mid mb-4">Summary</h2>
              <div className="border-t border-b10 pt-4 mb-6">
                <div className="flex justify-between">
                  <span>Items total</span>
                  <span>{quote ? `R${total.toFixed(2)}` : "-"}</span>
                </div>
                <p className="text-sm text-b60 mt-2">Delivery is added at checkout.</p>
                {quoting && <p className="micro text-b60 mt-2">Updating…</p>}
                {quoteError && (
                  <div className="mt-2 flex flex-wrap items-center gap-4">
                    <p className="text-sm text-brand">{quoteError}</p>
                    <button type="button" onClick={retry} className="linkr">
                      Try again
                    </button>
                  </div>
                )}
              </div>
              {blocked ? (
                <button type="button" disabled className="cta w-full">Checkout</button>
              ) : (
                <Link to="/checkout" className="cta w-full">Checkout</Link>
              )}
              <Link to="/shop" className="linkr mt-4 inline-block">Keep shopping</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
