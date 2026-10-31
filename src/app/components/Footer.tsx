import { Link } from "react-router";
import { Facebook, Instagram } from "lucide-react";
import { shop } from "../config/shop";
import { useCategories } from "../hooks/useCategories";
import { categoryPath } from "../utils/categoryPath";
import { SubscribeForm } from "./SubscribeForm";

export function Footer() {
  const year = new Date().getFullYear();
  const { categories } = useCategories();

  return (
    <footer className="site-footer mt-auto border-t border-b10 bg-paper text-ink">
      <div className="mx-auto w-full max-w-[1360px] px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-10 lg:flex-row">
          {/* Brand */}
          <div className="flex min-w-0 flex-1 flex-col gap-10">
            <p className="footer-brand font-semibold">4Nguru The Brand Online</p>
            <div className="max-w-sm">
              <h3 className="micro mb-4 text-b60">Join the list</h3>
              <SubscribeForm source="footer" compact />
            </div>
          </div>

          {/* Link columns */}
          <div className="footer-links grid min-w-0 flex-1 grid-cols-2 gap-10 md:grid-cols-2 xl:grid-cols-4">
            {categories.length > 0 && (
              <div>
                <h3 className="micro mb-4 text-b60">Shop</h3>
                <ul className="space-y-2">
                  {categories.map((cat) => (
                    <li key={cat.id}><Link to={categoryPath(cat.id)} className="text-sm hover:text-b60 transition-colors">{cat.name}</Link></li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="micro mb-4 text-b60">Customer Service</h3>
              <ul className="space-y-2">
                <li><Link to="/customer-service" className="text-sm hover:text-b60 transition-colors">Contact Us</Link></li>
                <li><Link to="/delivery" className="text-sm hover:text-b60 transition-colors">Shipping Info</Link></li>
                <li><Link to="/track" className="text-sm hover:text-b60 transition-colors">Track an order</Link></li>
                <li><Link to="/returns" className="text-sm hover:text-b60 transition-colors">Returns</Link></li>
                <li><Link to="/size-guide" className="text-sm hover:text-b60 transition-colors">Size Guide</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="micro mb-4 text-b60">About</h3>
              <ul className="space-y-2">
                <li><Link to="/about" className="text-sm hover:text-b60 transition-colors">Our Story</Link></li>
                <li><Link to="/events" className="text-sm hover:text-b60 transition-colors">Events</Link></li>
                <li><Link to="/community" className="text-sm hover:text-b60 transition-colors">Community</Link></li>
                <li><Link to="/terms" className="text-sm hover:text-b60 transition-colors">Terms</Link></li>
                <li><Link to="/privacy" className="text-sm hover:text-b60 transition-colors">Privacy</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="micro mb-4 text-b60">Follow Us</h3>
              <div className="flex gap-4">
                <a href={shop.social.tiktok} target="_blank" rel="noopener noreferrer" aria-label="TikTok" className="transition-colors hover:text-b60">
                  <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.04-.1z" />
                  </svg>
                </a>
                <a href={shop.social.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="transition-colors hover:text-b60">
                  <Instagram className="h-5 w-5" />
                </a>
                <a href={shop.social.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="transition-colors hover:text-b60">
                  <Facebook className="h-5 w-5" />
                </a>
              </div>
              <div className="mt-4 space-y-1 text-sm break-words">
                <p>Email: {shop.email}</p>
                <p>WhatsApp: {shop.phone}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-b10 pt-6">
          <p className="micro text-b60">&copy; {year} 4Nguru The Brand Online. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
