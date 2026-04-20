import { Link } from "react-router";
import { ShoppingCart, Menu, X, Shirt } from "lucide-react";
import { useState, useEffect } from "react";
import { getCartCount } from "../utils/storage";

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [cartCount, setCartCount] = useState(0);

  useEffect(() => {
    const updateCartCount = () => setCartCount(getCartCount());
    updateCartCount();
    window.addEventListener('storage', updateCartCount);
    window.addEventListener('cartUpdated', updateCartCount);
    return () => {
      window.removeEventListener('storage', updateCartCount);
      window.removeEventListener('cartUpdated', updateCartCount);
    };
  }, []);

  const categories = [
    { name: 'T-Shirts', path: '/tshirts' },
    { name: 'Jerseys', path: '/jerseys' },
    { name: 'Shorts', path: '/shorts' },
    { name: 'Pants', path: '/pants' },
    { name: 'Accessories', path: '/accessories' },
  ];

  return (
    <header className="bg-white shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo and Brand */}
          <Link to="/" className="flex items-center gap-2">
            <Shirt className="w-10 h-10 text-blue-600" />
            <span className="font-bold text-2xl md:text-3xl">
              <span className="text-yellow-500">C</span>
              <span className="text-green-500">l</span>
              <span className="text-blue-500">o</span>
              <span className="text-red-500">t</span>
              <span className="text-purple-500">h</span>
              <span className="text-white" style={{ textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000' }}>i</span>
              <span className="text-yellow-500">n</span>
              <span className="text-green-500">g</span>
              <span className="text-white" style={{ textShadow: '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, -2px 0 0 #000, 2px 0 0 #000, 0 -2px 0 #000, 0 2px 0 #000' }}> Store Online</span>
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex gap-6">
            {categories.map(cat => (
              <Link
                key={cat.path}
                to={cat.path}
                className="text-gray-700 hover:text-blue-600 transition-colors"
              >
                {cat.name}
              </Link>
            ))}
          </nav>

          {/* Cart and Mobile Menu */}
          <div className="flex items-center gap-4">
            <Link to="/cart" className="relative">
              <ShoppingCart className="w-6 h-6 text-gray-700 hover:text-blue-600" />
              {cartCount > 0 && (
                <span className="absolute -top-2 -right-2 bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {cartCount}
                </span>
              )}
            </Link>

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <nav className="md:hidden py-4 border-t">
            {categories.map(cat => (
              <Link
                key={cat.path}
                to={cat.path}
                className="block py-2 text-gray-700 hover:text-blue-600"
                onClick={() => setMobileMenuOpen(false)}
              >
                {cat.name}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
