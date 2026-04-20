import { Link } from "react-router";

export function Footer() {
  return (
    <footer className="bg-gray-900 text-white mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
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
              <li><a href="#" className="text-gray-400 hover:text-white">Contact Us</a></li>
              <li><a href="#" className="text-gray-400 hover:text-white">Shipping Info</a></li>
              <li><a href="#" className="text-gray-400 hover:text-white">Returns</a></li>
              <li><a href="#" className="text-gray-400 hover:text-white">Size Guide</a></li>
            </ul>
          </div>

          <div>
            <h3 className="font-bold mb-4">About</h3>
            <ul className="space-y-2">
              <li><a href="#" className="text-gray-400 hover:text-white">Our Story</a></li>
              <li><a href="#" className="text-gray-400 hover:text-white">Sustainability</a></li>
              <li><Link to="/admin" className="text-gray-400 hover:text-white">Admin</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-400">
          <p>&copy; 2026 Clothing Store Online. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
