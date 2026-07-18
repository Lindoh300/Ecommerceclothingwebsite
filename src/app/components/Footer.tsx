import { Link } from "react-router";
import { Facebook, Instagram } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-gray-900 text-white mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <h3 className="font-bold mb-4">Shop</h3>
            <ul className="space-y-2">
              <li><Link to="/tshirts" className="text-gray-400 hover:text-white">T-Shirts</Link></li>
              <li><Link to="/jerseys" className="text-gray-400 hover:text-white">Jerseys</Link></li>
              <li><Link to="/shorts" className="text-gray-400 hover:text-white">Shorts</Link></li>
              <li><Link to="/pants" className="text-gray-400 hover:text-white">Pants</Link></li>
              <li><Link to="/accessories" className="text-gray-400 hover:text-white">Accessories</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-bold mb-4">Customer Service</h3>
            <ul className="space-y-2">
              <li><Link to="/customer-service" className="text-gray-400 hover:text-white">Contact Us</Link></li>
              <li><Link to="/customer-service" className="text-gray-400 hover:text-white">Shipping Info</Link></li>
              <li><Link to="/customer-service" className="text-gray-400 hover:text-white">Returns</Link></li>
              <li><Link to="/customer-service" className="text-gray-400 hover:text-white">Size Guide</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-bold mb-4">About</h3>
            <ul className="space-y-2">
              <li><Link to="/about" className="text-gray-400 hover:text-white">Our Story</Link></li>
              <li><Link to="/about" className="text-gray-400 hover:text-white">Sustainability</Link></li>
              <li><Link to="/admin" className="text-gray-400 hover:text-white">Admin</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-bold mb-4">Follow Us</h3>
            <div className="flex gap-4">
              <a href="https://www.tiktok.com/@4nguru" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
                  <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.04-.1z" />
                </svg>
              </a>
              <a href="https://www.instagram.com/4nguruthebrand" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                <Instagram className="w-6 h-6" />
              </a>
              <a href="https://www.facebook.com/p/4nguru-The-Brand-100063554708976/" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                <Facebook className="w-6 h-6" />
              </a>
            </div>
            <div className="mt-4 text-sm text-gray-400">
              <p>Email: malandela03@gmail.com</p>
              <p>WhatsApp: +27 67 868 4428</p>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-400">
          <p>&copy; 2008 4Nguru The Brand Online. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
