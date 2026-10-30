import { Link, NavLink } from "react-router";
import { ShoppingCart, Menu, X } from "lucide-react";
import { useState, useEffect } from "react";
import { getCartCount } from "../utils/storage";
import { useCategories } from "../hooks/useCategories";
import { categoryPath } from "../utils/categoryPath";

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

  // If categories fail to load the nav still renders, with just About.
  const { categories: managed } = useCategories();
  const categories = [
    ...managed.map((c) => ({ name: c.name, path: categoryPath(c.id) })),
    { name: 'About', path: '/about' },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-b10 bg-paper/[0.92] backdrop-blur-md">
      <div className="relative mx-auto flex h-16 w-full max-w-[1968px] items-center justify-between px-6">
        {/* Logo and Brand */}
        <Link to="/" className="flex items-center gap-3">
          <img
            src="/images/logo.jpg"
            alt="Logo"
            className="w-10 h-10 md:w-12 md:h-12 rounded-full object-cover"
            onError={(e) => {
              e.currentTarget.src = '/images/logo-placeholder.svg';
            }}
          />
          <span className="font-bold text-2xl md:text-3xl">
            <span className="text-yellow-500">4</span>
            <span className="text-green-500">N</span>
            <span className="text-blue-500">g</span>
            <span className="text-red-500">u</span>
            <span className="text-purple-500">r</span>
            <span className="text-yellow-500">u</span>
            <span className="text-ink hidden sm:inline"> The Brand Online</span>
          </span>
        </Link>

        {/* Desktop Navigation, centred */}
        <nav className="hidden items-center gap-5 lg:flex 2xl:absolute 2xl:left-1/2 2xl:-translate-x-1/2 2xl:gap-6">
          {categories.map(cat => (
            <NavLink
              key={cat.path}
              to={cat.path}
              className={({ isActive }) =>
                [
                  'relative py-1 text-sm caps-track text-ink transition-opacity hover:opacity-60',
                  isActive
                    ? "after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:bg-prism after:content-['']"
                    : '',
                ].join(' ')
              }
            >
              {cat.name}
            </NavLink>
          ))}
        </nav>

        {/* Cart and Mobile Menu */}
        <div className="flex items-center gap-4">
          <Link to="/cart" aria-label="Cart" className="relative text-ink transition-opacity hover:opacity-60">
            <ShoppingCart className="h-6 w-6" />
            {cartCount > 0 && (
              <span className="absolute -right-2 -top-2 flex h-[18px] min-w-[18px] items-center justify-center bg-prism px-1 font-mono text-[10px] leading-none text-on-accent">
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
            className="text-ink lg:hidden"
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <nav id="mobile-menu" className="border-t border-b10 bg-paper px-6 lg:hidden">
          {categories.map(cat => (
            <NavLink
              key={cat.path}
              to={cat.path}
              className={({ isActive }) =>
                `block border-b border-b10 py-5 font-display h-case text-3xl leading-none text-ink ${isActive ? 'text-prism' : ''}`
              }
              onClick={() => setMobileMenuOpen(false)}
            >
              {cat.name}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  );
}
