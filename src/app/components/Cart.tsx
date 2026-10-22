import { useState, useEffect, useRef } from "react";
import { Link } from "react-router";
import { getCart, removeFromCart, updateCartItem, clearCart, getCartQuantityForProduct, getAvailableStock } from "../utils/storage";
import { Trash2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { ProductImage } from "./prism/ProductImage";
import { whatsappLink } from "../config/shop";
import { useProducts } from "../hooks/useProducts";
import { quoteCart } from "../api/products";
import type { CartQuote } from "../api/types";

export function Cart() {
  const [lines, setLines] = useState(getCart());
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const { products, loading: productsLoading, error: productsError } = useProducts();
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
  const isUnavailable = (productId: string) => productsReady && !productsById.has(productId);
  const hasUnavailable = lines.some((line) => isUnavailable(line.productId));
  const total = quote?.total ?? 0;

  const handleUpdateQuantity = (index: number, quantity: number) => {
    if (quantity < 1) return;
    const updated = updateCartItem(index, quantity);
    if (!updated) {
      const line = lines[index];
      const available = getAvailableStock(line.productId);
      toast.error('Not enough stock', {
        description: `Only ${available} available.`
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

  const handleWhatsAppCheckout = () => {
    if (lines.length === 0) return;
    if (!quote || quoting) {
      toast.error('Please wait for prices to update');
      return;
    }
    if (quote.missing.length > 0 || hasUnavailable) {
      toast.error('Remove unavailable items first');
      return;
    }

    let message = "Hi! I'd like to place an order:\n\n";

    quote.lines.forEach((line, index) => {
      message += `${index + 1}. ${line.name}\n`;
      message += `   - Price: R${line.price}\n`;
      message += `   - Quantity: ${line.quantity}\n`;
      if (line.size) message += `   - Size: ${line.size}\n`;
      if (line.color) message += `   - Color: ${line.color}\n`;
      message += `   - Subtotal: R${line.subtotal}\n`;
      if (line.image && line.image.startsWith('http')) {
        message += `   - Image: ${line.image}\n`;
      }
      message += `\n`;
    });

    message += `Total: R${quote.total.toFixed(2)}`;

    window.open(whatsappLink(message), '_blank');

    setAwaitingConfirm(true);
  };

  const handleConfirmSent = () => {
    clearCart();
    refreshCart();
    window.dispatchEvent(new Event('cartUpdated'));
    setAwaitingConfirm(false);
    toast.success('Order sent', {
      description: 'Thanks! We will reply on WhatsApp.'
    });
  };

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
            <div className="border-t border-b10">
              {lines.map((item, index) => {
                const product = productsById.get(item.productId);
                const unavailable = isUnavailable(item.productId);
                return (
                <div key={`${item.productId}-${index}`} className="flex gap-6 py-6 border-b border-b10">
                  <div className="w-24 h-24 shrink-0 bg-b5 overflow-hidden">
                    <ProductImage src={product?.image} alt={product?.name ?? "Unavailable item"} seed={item.productId} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="uppercase font-display font-bold tracking-tight mb-1">{product?.name ?? (unavailable ? "Unavailable item" : "Loading…")}</h3>
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
                      className="text-b60 hover:text-prism transition-colors"
                      aria-label="Remove item"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleUpdateQuantity(index, item.quantity - 1)}
                        className="w-8 h-8 border border-b10 text-ink hover:border-ink transition-colors"
                      >
                        -
                      </button>
                      <span className="w-8 text-center font-mono">{item.quantity}</span>
                      <button
                        onClick={() => handleUpdateQuantity(index, item.quantity + 1)}
                        disabled={unavailable || getCartQuantityForProduct(item.productId) >= getAvailableStock(item.productId, product?.stock ?? 0)}
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
              <div className="space-y-2 mb-4">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="font-mono">{quote ? `R${total.toFixed(2)}` : "-"}</span>
                </div>
                <div className="flex justify-between text-sm text-b60">
                  <span>Shipping</span>
                  <span>Calculated on WhatsApp</span>
                </div>
              </div>
              <div className="border-t border-b10 pt-4 mb-6">
                <div className="flex justify-between">
                  <span>Total</span>
                  <span className="font-mono">{quote ? `R${total.toFixed(2)}` : "-"}</span>
                </div>
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
              <button
                onClick={handleWhatsAppCheckout}
                disabled={quoting || hasUnavailable || (quote?.missing.length ?? 0) > 0}
                className="cta w-full"
              >
                <MessageCircle className="w-5 h-5" />
                {awaitingConfirm ? "Open WhatsApp again" : "Checkout on WhatsApp"}
              </button>
              {awaitingConfirm && (
                <div className="border border-b10 p-4 mt-4">
                  <p className="micro text-b60 mb-2">Did you send your order?</p>
                  <p className="text-b60 text-sm mb-4">
                    Your cart is kept until you confirm, in case WhatsApp didn't send.
                  </p>
                  <div className="flex flex-wrap items-center gap-4">
                    <button onClick={handleConfirmSent} className="cta">
                      Yes, clear cart
                    </button>
                    <button onClick={() => setAwaitingConfirm(false)} className="linkr">
                      Not yet
                    </button>
                  </div>
                </div>
              )}
              <p className="micro text-b60 text-center mt-4 text-xs">
                Opens WhatsApp with your order. Your cart stays until you confirm.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
