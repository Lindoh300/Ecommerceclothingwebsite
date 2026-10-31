import { useState, useEffect, useRef } from "react";
import { Link } from "react-router";
import type { CartLine } from "../utils/storage";
import { getCart, removeFromCart, updateCartItem, clearCart, findVariant, getVariantStock } from "../utils/storage";
import { Trash2 } from "lucide-react";
import { toast } from "../lib/toast";
import { ProductImage } from "./prism/ProductImage";
import { CheckoutPanel } from "./CheckoutPanel";
import { useProducts } from "../hooks/useProducts";
import { quoteCart } from "../api/products";
import type { CartQuote } from "../api/types";

export function Cart() {
  // The cart lives in the browser. It is read after mount, so the server and the first client
  // render both show the same neutral page and hydration matches.
  const [lines, setLines] = useState<CartLine[]>([]);
  const [cartReady, setCartReady] = useState(false);
  const { products, loading: productsLoading, error: productsError, reload } = useProducts();
  const [orderPlaced, setOrderPlaced] = useState(false);
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

  const handleCartCleared = () => {
    clearCart();
    refreshCart();
    window.dispatchEvent(new Event('cartUpdated'));
  };

  if (!cartReady) {
    return <div className="min-h-screen bg-paper" />;
  }

  if (lines.length === 0) {
    return (
      <div className="min-h-screen bg-paper py-16 md:py-24">
        <div className="max-w-[1968px] mx-auto px-6 text-center">
          <p className="micro text-b60 mb-3">Your bag</p>
          <h2 className="display h-sec mb-6">Your cart is empty</h2>
          <p className="text-b60 mb-10">Start shopping to add items to your cart</p>
          <Link to="/" className="cta">Continue shopping</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper py-12 md:py-16">
      <div className="max-w-[1968px] mx-auto px-6">
        <p className="micro text-b60 mb-3">Your bag</p>
        <h1 className="display h-sec mb-12">Cart</h1>

        <div className="grid lg:grid-cols-3 gap-10 lg:gap-16">
          {/* Cart Items */}
          <div className="lg:col-span-2">
            {orderPlaced && (
              <p className="micro text-b60 mb-4">Order saved. Your cart is locked until you confirm it was sent.</p>
            )}
            <div className="border-t border-b10">
              {lines.map((item, index) => {
                const product = productsById.get(item.productId);
                const unavailable = isUnavailable(item);
                return (
                <div key={`${item.productId}-${index}`} className="flex gap-6 py-6 border-b border-b10">
                  <div className="w-24 h-24 shrink-0 bg-b5 overflow-hidden r-card">
                    <ProductImage src={product?.image} alt={product?.name ?? "Unavailable item"} seed={item.productId} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display h-weight h-case h-track-sm mb-1">{product?.name ?? (unavailable ? "Unavailable item" : "Loading…")}</h3>
                    <p className="micro text-b60 mb-2">
                      {item.size && `Size: ${item.size}`}
                      {item.size && item.color && ' | '}
                      {item.color && `Color: ${item.color}`}
                    </p>
                    {unavailable ? (
                      <p className="text-prism">No longer available</p>
                    ) : product ? (
                      <p className="font-mono text-ink">R{product.price}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end justify-between">
                    <button
                      onClick={() => handleRemove(index)}
                      disabled={orderPlaced}
                      className="text-b60 hover:text-prism transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      aria-label="Remove item"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleUpdateQuantity(index, item.quantity - 1)}
                        disabled={orderPlaced}
                        className="w-8 h-8 border border-b10 text-ink hover:border-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        -
                      </button>
                      <span className="w-8 text-center font-mono">{item.quantity}</span>
                      <button
                        onClick={() => handleUpdateQuantity(index, item.quantity + 1)}
                        disabled={orderPlaced || unavailable || quantityInCart(item) >= availableFor(item)}
                        className="w-8 h-8 border border-b10 text-ink hover:border-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </div>

          {/* Order Summary */}
          <div className="lg:col-span-1">
            <div className="border border-b10 p-6 sticky top-24">
              <p className="micro text-b60 mb-4">Order summary</p>
              <div className="border-t border-b10 pt-4 mb-6">
                <div className="flex justify-between">
                  <span>Items total</span>
                  <span className="font-mono">{quote ? `R${total.toFixed(2)}` : "-"}</span>
                </div>
                <p className="text-sm text-b60 mt-2">Delivery is added at checkout.</p>
                {quoting && <p className="micro text-b60 mt-2">Updating…</p>}
                {quoteError && (
                  <div className="mt-2 flex flex-wrap items-center gap-4">
                    <p className="text-sm text-prism">{quoteError}</p>
                    <button type="button" onClick={() => setRetryCount((n) => n + 1)} className="linkr">
                      Try again
                    </button>
                  </div>
                )}
              </div>
              <CheckoutPanel
                items={JSON.parse(linesKey)}
                blocked={!quote || quoting || hasUnavailable || quote.missing.length > 0}
                onStockShort={() => { reload().catch(() => {}); }}
                onCartCleared={handleCartCleared}
                onOrderChange={setOrderPlaced}
                itemsTotal={quote ? quote.total : undefined}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
