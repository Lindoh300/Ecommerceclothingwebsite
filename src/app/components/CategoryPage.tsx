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
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-4xl mb-8">{categoryNames[category]}</h1>

        {products.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 text-lg">No products available in this category yet.</p>
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
