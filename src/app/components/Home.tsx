import { Link } from "react-router";
import { getProducts } from "../utils/storage";
import { ProductCard } from "./ProductCard";

export function Home() {
  const featuredProducts = getProducts().slice(0, 100);

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section
        className="text-white py-20 bg-gray-700 relative"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h1 className="text-4xl md:text-6xl mb-6 drop-shadow-lg">Welcome to 4Nguru The brand Online</h1>
          <p className="text-xl md:text-2xl mb-8 drop-shadow-lg">Premium quality clothing for every occasion</p>
          <Link
            to="/tshirts"
            className="inline-block bg-white text-blue-600 px-8 py-3 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Shop Now
          </Link>
        </div>
      </section>

      {/* Categories */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl text-center mb-12">Shop by Category</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {[
              { name: 'T-Shirts', path: '/tshirts', emoji: '👕' },
              { name: 'Jerseys', path: '/jerseys', emoji: '🎽' },
              { name: 'Shorts', path: '/shorts', emoji: '🩳' },
              { name: 'Pants', path: '/pants', emoji: '👖' },
              { name: 'Accessories', path: '/accessories', emoji: '🧢' },
            ].map(cat => (
              <Link
                key={cat.path}
                to={cat.path}
                className="bg-white p-6 rounded-lg shadow hover:shadow-lg transition-shadow text-center"
              >
                <div className="text-4xl mb-2">{cat.emoji}</div>
                <h3>{cat.name}</h3>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Products */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl text-center mb-12">Featured Products</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {featuredProducts.map(product => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
