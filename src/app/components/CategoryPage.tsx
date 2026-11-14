import { Link } from "react-router";
import { useProducts } from "../hooks/useProducts";
import { useCategories } from "../hooks/useCategories";
import { ProductGrid } from "./ProductGrid";
import { LoadState } from "./common";

interface CategoryPageProps {
  id: string;
}

export function CategoryPage({ id }: CategoryPageProps) {
  const { products: allProducts, loading: productsLoading, error: productsError, reload: reloadProducts } = useProducts();
  const { categories, loading: categoriesLoading, error: categoriesError, reload: reloadCategories } = useCategories();
  const category = categories.find((c) => c.id === id);
  const products = allProducts.filter((p) => p.category === id);
  const loading = categoriesLoading || productsLoading;
  const error = categoriesError ?? productsError;
  const retry = () => {
    if (categoriesError) reloadCategories().catch(() => {});
    if (productsError) reloadProducts().catch(() => {});
  };

  return (
    <div className="min-h-screen bg-paper py-12 md:py-16">
      <div className="max-w-[1360px] mx-auto px-6">
        <LoadState loading={loading} error={error} onRetry={retry}>
          {!category ? (
            <div className="border border-b10 r-card p-12 text-center">
              <p className="page-kicker micro text-b60 mb-3">Shop</p>
              <h1 className="display h-mid mb-6">Category not found</h1>
              <Link to="/" className="linkr text-ink mx-auto">
                Back to home
              </Link>
            </div>
          ) : (
            <>
              <p className="micro text-b60 mb-3">
                <Link to="/shop" className="hover:text-ink">Shop</Link> / {products.length} {products.length === 1 ? 'item' : 'items'}
              </p>
              <h1 className="display h-sec mb-12">{category.name}</h1>
              {products.length === 0 ? (
                <div className="border border-b10 r-card p-12 text-center">
                  <p className="text-b60 text-lg mb-6">No products available in this category yet.</p>
                  <Link to="/" className="linkr text-ink mx-auto">
                    Back to home
                  </Link>
                </div>
              ) : (
                <ProductGrid products={products} />
              )}
            </>
          )}
        </LoadState>
      </div>
    </div>
  );
}
