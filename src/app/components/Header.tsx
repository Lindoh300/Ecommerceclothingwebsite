import { Link, NavLink } from "react-router";
import { ShoppingCart, Menu, X } from "lucide-react";
import { useState, useEffect } from "react";
import { getCartCount } from "../utils/storage";
import { ThemeToggle } from "./ThemeToggle";

const navLinks = [
  { name: "Shop", path: "/shop" },
  { name: "Events", path: "/events" },
  { name: "Community", path: "/community" },
];

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

  return (
    <header className="site-header sticky top-0 z-50 border-b border-b10 bg-paper">
      <div className="site-header-row relative mx-auto flex h-14 w-full max-w-[1360px] items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <Link to="/" aria-label="4Nguru home" className="flex items-center">
          <span className="font-bold text-xl">
            <span className="text-yellow-500">4</span>
            <span className="text-green-500">N</span>
            <span className="text-blue-500">g</span>
            <span className="text-red-500">u</span>
            <span className="text-purple-500">r</span>
            <span className="text-yellow-500">u</span>
          </span>
        </Link>

        {/* Desktop Navigation, centred */}
        <nav className="site-nav hidden items-center gap-6 md:absolute md:left-1/2 md:flex md:-translate-x-1/2">
          {navLinks.map(link => (
            <NavLink
              key={link.path}
              to={link.path}
              className={({ isActive }) =>
                ['nav-link text-sm text-ink hover:text-b60 transition-colors', isActive ? 'font-semibold' : ''].join(' ')
              }
            >
              {link.name}
            </NavLink>
          ))}
        </nav>

        {/* Cart and Mobile Menu */}
        <div className="flex items-center gap-2 sm:gap-4">
          <ThemeToggle />
          <Link to="/cart" aria-label={cartCount === 0 ? "Cart" : cartCount === 1 ? "Cart, 1 item" : `Cart, ${cartCount} items`} className="cart-link relative flex items-center gap-2 text-ink transition-opacity hover:opacity-60">
            <ShoppingCart className="h-5 w-5" />
            <span className="hidden sm:inline text-sm">Cart</span>
            {cartCount > 0 && (
              <span className="cart-badge absolute -right-2 -top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] leading-none text-on-accent">
                {cartCount}
              </span>
            )}
          </Link>

          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-menu"
            className="menu-toggle text-ink md:hidden"
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <nav id="mobile-menu" className="mobile-nav border-t border-b10 bg-paper px-6 md:hidden">
          {navLinks.map(link => (
            <NavLink
              key={link.path}
              to={link.path}
              className={({ isActive }) =>
                ['mobile-nav-link block border-b border-b10 py-4 text-base text-ink', isActive ? 'font-semibold' : ''].join(' ')
              }
              onClick={() => setMobileMenuOpen(false)}
            >
              {link.name}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  );
}
