import { Link } from "react-router";
import { Facebook, Instagram } from "lucide-react";
import { shop } from "../config/shop";
import { useCategories } from "../hooks/useCategories";
import { categoryPath } from "../utils/categoryPath";

export function Footer() {
  const year = new Date().getFullYear();
  const { categories } = useCategories();

  return (
    <footer className="mt-auto border-t border-b10 bg-paper text-ink">
      <div className="mx-auto w-full max-w-[1968px] px-6 py-16">
        <div className="flex flex-col gap-16 lg:flex-row lg:gap-12">
          {/* Brand */}
          <div className="flex min-w-0 flex-1 flex-col gap-10">
            <p className="font-display h-weight h-case h-track-xl h-lead-open text-6xl md:text-8xl">
              4NGURU
            </p>
            <p className="max-w-[260px] text-lg leading-[1.45]">
              Premium quality clothing for every occasion.
            </p>
          </div>

          {/* Link columns */}
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-10 md:grid-cols-2 xl:grid-cols-4">
            {categories.length > 0 && (
              <div>
                <h3 className="micro mb-4 text-b60">Shop</h3>
                <ul className="space-y-2">
                  {categories.map((cat) => (
                    <li key={cat.id}><Link to={categoryPath(cat.id)} className="text-sm caps hover:text-prism transition-colors">{cat.name}</Link></li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="micro mb-4 text-b60">Customer Service</h3>
              <ul className="space-y-2">
                <li><Link to="/customer-service" className="text-sm caps hover:text-prism transition-colors">Contact Us</Link></li>
                <li><Link to="/customer-service" className="text-sm caps hover:text-prism transition-colors">Shipping Info</Link></li>
                <li><Link to="/customer-service" className="text-sm caps hover:text-prism transition-colors">Returns</Link></li>
                <li><Link to="/customer-service" className="text-sm caps hover:text-prism transition-colors">Size Guide</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="micro mb-4 text-b60">About</h3>
              <ul className="space-y-2">
                <li><Link to="/about" className="text-sm caps hover:text-prism transition-colors">Our Story</Link></li>
                <li><Link to="/about" className="text-sm caps hover:text-prism transition-colors">Sustainability</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="micro mb-4 text-b60">Follow Us</h3>
              <div className="flex gap-4">
                <a href={shop.social.tiktok} target="_blank" rel="noopener noreferrer" aria-label="TikTok" className="transition-colors hover:text-prism">
                  <svg className="h-6 w-6 fill-current" viewBox="0 0 24 24">
                    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.04-.1z" />
                  </svg>
                </a>
                <a href={shop.social.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="transition-colors hover:text-prism">
                  <Instagram className="h-6 w-6" />
                </a>
                <a href={shop.social.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="transition-colors hover:text-prism">
                  <Facebook className="h-6 w-6" />
                </a>
              </div>
              <div className="mt-4 space-y-1 font-mono text-sm break-words">
                <p>Email: {shop.email}</p>
                <p>WhatsApp: {shop.phone}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-16 border-t border-b10 pt-6">
          <p className="micro text-b60">&copy; {year} 4Nguru The Brand Online. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
