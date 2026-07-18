import { useState, useEffect } from "react";
import { Link } from "react-router";
import { getCart, removeFromCart, updateCartItem, getCartTotal, clearCart } from "../utils/storage";
import { Trash2, ShoppingBag, MessageCircle } from "lucide-react";
import { Button } from "./ui/button";

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
      <div className="min-h-screen bg-gray-50 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <ShoppingBag className="w-24 h-24 mx-auto text-gray-400 mb-4" />
          <h2 className="text-2xl mb-4">Your cart is empty</h2>
          <p className="text-gray-600 mb-8">Start shopping to add items to your cart</p>
          <Link to="/">
            <Button>Continue Shopping</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl mb-8">Shopping Cart</h1>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Cart Items */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow">
              {cart.map((item, index) => (
                <div key={`${item.id}-${index}`} className="flex gap-4 p-4 border-b last:border-b-0">
                  <img
                    src={item.image}
                    alt={item.name}
                    className="w-24 h-24 object-cover rounded"
                    onError={(e) => {
                      e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23e5e7eb" width="100" height="100"/%3E%3C/svg%3E';
                    }}
                  />
                  <div className="flex-1">
                    <h3 className="mb-1">{item.name}</h3>
                    <p className="text-sm text-gray-600 mb-2">
                      {item.selectedSize && `Size: ${item.selectedSize}`}
                      {item.selectedSize && item.selectedColor && ' | '}
                      {item.selectedColor && `Color: ${item.selectedColor}`}
                    </p>
                    <p className="text-blue-600">R{item.price}</p>
                  </div>
                  <div className="flex flex-col items-end justify-between">
                    <button
                      onClick={() => handleRemove(index)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleUpdateQuantity(index, item.quantity - 1)}
                        className="w-8 h-8 border border-gray-300 rounded hover:bg-gray-100"
                      >
                        -
                      </button>
                      <span className="w-8 text-center">{item.quantity}</span>
                      <button
                        onClick={() => handleUpdateQuantity(index, item.quantity + 1)}
                        className="w-8 h-8 border border-gray-300 rounded hover:bg-gray-100"
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
            <div className="bg-white rounded-lg shadow p-6 sticky top-20">
              <h2 className="text-xl mb-4">Order Summary</h2>
              <div className="space-y-2 mb-4">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>R{total.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Shipping</span>
                  <span>Calculated on WhatsApp</span>
                </div>
              </div>
              <div className="border-t pt-4 mb-6">
                <div className="flex justify-between">
                  <span>Total</span>
                  <span>R{total.toFixed(2)}</span>
                </div>
              </div>
              <Button
                onClick={handleWhatsAppCheckout}
                className="w-full py-6 bg-green-600 hover:bg-green-700"
              >
                <MessageCircle className="w-5 h-5 mr-2" />
                Checkout on WhatsApp
              </Button>
              <p className="text-xs text-gray-500 text-center mt-4">
                Click to send your order via WhatsApp
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
