import { useMemo } from "react";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { useProducts } from "../hooks/useProducts";
import { useCategories } from "../hooks/useCategories";
import { categoryPath } from "../utils/categoryPath";
import { shop, whatsappLink } from "../config/shop";
import { ProductGrid } from "./ProductGrid";
import { LoadState } from "./common";
import { isGallery } from "../config/theme";
import { HomeGallery } from "./HomeGallery";

const FEATURED_COUNT = 8;

export function Home() {
  const { products, loading, error, reload } = useProducts();
  const { categories, loading: categoriesLoading, error: categoriesError, reload: reloadCategories } = useCategories();

  // The newest active products, in stock first so the front of the shop is not sold-out items.
  const featured = useMemo(() => {
    const active = products
      .filter((p) => p.active !== false)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    const inStock = active.filter((p) => p.stock > 0);
    return (inStock.length >= FEATURED_COUNT ? inStock : [...inStock, ...active.filter((p) => p.stock <= 0)]).slice(0, FEATURED_COUNT);
  }, [products]);

  if (isGallery) {
    return (
      <HomeGallery
        products={products}
        loading={loading}
        error={error}
        reload={reload}
        categories={categories}
        categoriesLoading={categoriesLoading}
        categoriesError={categoriesError}
        reloadCategories={reloadCategories}
        featured={featured}
      />
    );
  }

  return (
    <div>
      {/* Hero */}
      <section className="border-b border-b10 px-4 sm:px-6 py-12 md:py-16">
        <div className="max-w-[1360px] mx-auto">
          <p className="micro text-b60 mb-2">South African clothing</p>
          <h1 className="display h-sec mb-3">4Nguru The Brand</h1>
          <p className="text-b60 max-w-prose mb-6">
            Premium quality clothing for every occasion. Shop online, or message us on WhatsApp to order. We deliver across South Africa.
          </p>
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <Link to="/shop" className="cta">Shop all</Link>
            <a href={whatsappLink(`Hi ${shop.name}, I would like to ask about your clothing.`)} target="_blank" rel="noopener noreferrer" className="linkr text-ink">
              Ask on WhatsApp
              <ArrowRight aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      {/* Featured */}
      <section className="px-4 sm:px-6 py-10 md:py-14">
        <div className="max-w-[1360px] mx-auto">
          <div className="flex items-end justify-between gap-4 mb-6">
            <h2 className="display h-mid">New in</h2>
            <Link to="/shop" className="linkr text-ink">
              All products
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
          <LoadState loading={loading} error={error} onRetry={() => reload().catch(() => {})}>
            {featured.length === 0 ? (
              <div className="border border-b10 p-8 text-center">
                <p className="text-b60">No products to show yet.</p>
              </div>
            ) : (
              <ProductGrid products={featured} />
            )}
          </LoadState>
        </div>
      </section>

      {/* Categories */}
      <section className="px-4 sm:px-6 pb-14">
        <div className="max-w-[1360px] mx-auto">
          <h2 className="display h-mid mb-6">Shop by category</h2>
          <LoadState loading={categoriesLoading} error={categoriesError} onRetry={() => reloadCategories().catch(() => {})}>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {categories.map((cat) => (
                <Link
                  key={cat.id}
                  to={categoryPath(cat.id)}
                  className="flex items-center justify-between gap-2 border border-b10 bg-paper px-4 py-4 text-sm font-medium hover:bg-b5 transition-colors"
                >
                  {cat.name}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </LoadState>
        </div>
      </section>
    </div>
  );
}
