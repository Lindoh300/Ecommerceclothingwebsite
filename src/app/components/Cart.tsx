import { useState, useEffect } from "react";
import { Link } from "react-router";
import { getCart, removeFromCart, updateCartItem, getCartTotal, clearCart } from "../utils/storage";
import { Trash2, MessageCircle } from "lucide-react";
import { ProductImage } from "./prism/ProductImage";

export function Cart() {
  const [cart, setCart] = useState(getCart());
  const [total, setTotal] = useState(getCartTotal());

  const refreshCart = () => {
    setCart(getCart());
    setTotal(getCartTotal());
  };

  useEffect(() => {
    refreshCart();
  }, []);

  const handleUpdateQuantity = (index: number, quantity: number) => {
    if (quantity < 1) return;
    updateCartItem(index, quantity);
    refreshCart();
    window.dispatchEvent(new Event('cartUpdated'));
  };

  const handleRemove = (index: number) => {
    removeFromCart(index);
    refreshCart();
    window.dispatchEvent(new Event('cartUpdated'));
  };

  const handleWhatsAppCheckout = () => {
    if (cart.length === 0) return;

    const siteUrl = window.location.origin;
    let message = "Hi! I'd like to place an order:\n\n";

    cart.forEach((item, index) => {
      message += `${index + 1}. ${item.name}\n`;
      message += `   - Price: R${item.price}\n`;
      message += `   - Quantity: ${item.quantity}\n`;
      if (item.selectedSize) message += `   - Size: ${item.selectedSize}\n`;
      if (item.selectedColor) message += `   - Color: ${item.selectedColor}\n`;
      message += `   - Subtotal: R${item.price * item.quantity}\n`;

      // Add image URL if it's a web-accessible path
      if (item.image && !item.image.startsWith('data:')) {
        const imageUrl = item.image.startsWith('http') ? item.image : `${siteUrl}${item.image}`;
        message += `   - Image: ${imageUrl}\n`;
      }
      message += `\n`;
    });

    message += `Total: R${total.toFixed(2)}`;

    const encodedMessage = encodeURIComponent(message);
    const whatsappNumber = "27678684428"; // 4Nguru The Brand Online WhatsApp
    window.open(`https://wa.me/${whatsappNumber}?text=${encodedMessage}`, '_blank');

    clearCart();
    refreshCart();
    window.dispatchEvent(new Event('cartUpdated'));
  };

  if (cart.length === 0) {
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
              {cart.map((item, index) => (
                <div key={`${item.id}-${index}`} className="flex gap-6 py-6 border-b border-b10">
                  <div className="w-24 h-24 shrink-0 bg-b5 overflow-hidden">
                    <ProductImage src={item.image} alt={item.name} seed={item.id} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="uppercase font-display font-bold tracking-tight mb-1">{item.name}</h3>
                    <p className="micro text-b60 mb-2">
                      {item.selectedSize && `Size: ${item.selectedSize}`}
                      {item.selectedSize && item.selectedColor && ' | '}
                      {item.selectedColor && `Color: ${item.selectedColor}`}
                    </p>
                    <p className="font-mono text-ink">R{item.price}</p>
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
                        className="w-8 h-8 border border-b10 text-ink hover:border-ink transition-colors"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Order Summary */}
          <div className="lg:col-span-1">
            <div className="border border-b10 p-6 sticky top-24">
              <p className="micro text-b60 mb-4">Order summary</p>
              <div className="space-y-2 mb-4">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="font-mono">R{total.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm text-b60">
                  <span>Shipping</span>
                  <span>Calculated on WhatsApp</span>
                </div>
              </div>
              <div className="border-t border-b10 pt-4 mb-6">
                <div className="flex justify-between">
                  <span>Total</span>
                  <span className="font-mono">R{total.toFixed(2)}</span>
                </div>
              </div>
              <button
                onClick={handleWhatsAppCheckout}
                className="cta w-full"
              >
                <MessageCircle className="w-5 h-5" />
                Checkout on WhatsApp
              </button>
              <p className="micro text-b60 text-center mt-4 text-xs">
                Click to send your order via WhatsApp
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
