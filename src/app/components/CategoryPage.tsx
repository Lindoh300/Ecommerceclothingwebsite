import { Link } from "react-router";
import { getProductsByCategory } from "../utils/storage";
import { ProductCard } from "./ProductCard";

interface CategoryPageProps {
  category: string;
}

export function CategoryPage({ category }: CategoryPageProps) {
  const products = getProductsByCategory(category);
  const categoryNames: Record<string, string> = {
    tshirts: 'T-Shirts',
    jerseys: 'Jerseys',
    shorts: 'Shorts',
    pants: 'Pants',
    accessories: 'Accessories'
  };

  return (
    <div className="min-h-screen bg-paper py-12 md:py-16">
      <div className="max-w-[1968px] mx-auto px-6">
        <p className="micro text-b60 mb-3">Shop / {products.length} {products.length === 1 ? 'item' : 'items'}</p>
        <h1 className="display h-sec mb-12">{categoryNames[category]}</h1>

        {products.length === 0 ? (
          <div className="border border-b10 p-12 text-center">
            <p className="text-b60 text-lg mb-6">No products available in this category yet.</p>
            <Link to="/" className="linkr text-ink mx-auto">
              Back to home
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {products.map(product => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
