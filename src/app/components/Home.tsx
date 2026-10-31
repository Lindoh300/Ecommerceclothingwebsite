import { useMemo } from "react";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { useProducts } from "../hooks/useProducts";
import { useCategories } from "../hooks/useCategories";
import { categoryPath } from "../utils/categoryPath";
import { shop, whatsappLink } from "../config/shop";
import { ProductGrid } from "./ProductGrid";
import { GooArt, LoadState, Ticker } from "./prism";

const FEATURED_COUNT = 8;

const tickerItems = (categoryNames: string[]) => [
  ...categoryNames,
  "Order on WhatsApp",
  "Delivery across South Africa",
];

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

  return (
    <div className="min-h-screen overflow-x-hidden">
      {/* Hero */}
      <section className="px-6 py-10 md:py-20">
        <div className="max-w-[1968px] mx-auto grid items-center gap-10 md:grid-cols-2 md:gap-16">
          <div className="min-w-0">
            <p className="micro text-b60 mb-4">South African clothing</p>
            <h1 className="display text-[clamp(56px,14vw,200px)] mb-6">
              <span className="sr-only">4Nguru The Brand Online</span>
              <span aria-hidden="true">4Nguru</span>
            </h1>
            <p className="hand mb-6" aria-hidden="true">the brand</p>
            <p className="text-b60 text-lg max-w-prose mb-8">
              Shop online, or message us on WhatsApp to order. We deliver across South Africa.
            </p>
            <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
              <Link to="/shop" className="cta">Shop all</Link>
              <a href={whatsappLink(`Hi ${shop.name}, I would like to ask about your clothing.`)} target="_blank" rel="noopener noreferrer" className="linkr text-ink">
                Ask on WhatsApp
                <ArrowRight aria-hidden="true" />
              </a>
            </div>
          </div>
          <div className="relative aspect-square overflow-hidden" aria-hidden="true">
            <GooArt variant="hero" cols={8} rows={8} resampleMs={7000} />
          </div>
        </div>
      </section>

      <Ticker items={tickerItems(categories.map((c) => c.name))} />

      {/* Featured */}
      <section className="px-6 py-16 md:py-24">
        <div className="max-w-[1968px] mx-auto">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-10">
            <p className="micro text-b60">01 / New in</p>
            <h2 className="display h-mid">Latest products</h2>
          </div>
          <LoadState loading={loading} error={error} onRetry={() => reload().catch(() => {})}>
            {featured.length === 0 ? (
              <div className="border border-b10 p-8 text-center md:p-12">
                <p className="text-b60 mb-6">No products to show yet.</p>
              </div>
            ) : (
              <ProductGrid products={featured} />
            )}
            <div className="mt-10">
              <Link to="/shop" className="linkr text-ink">
                See everything in the shop
                <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </LoadState>
        </div>
      </section>

      {/* Categories */}
      <section className="px-6 pb-16 md:pb-24">
        <div className="max-w-[1968px] mx-auto">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-10">
            <p className="micro text-b60">02 / Categories</p>
            <h2 className="display h-mid">Shop by category</h2>
          </div>
          <LoadState loading={categoriesLoading} error={categoriesError} onRetry={() => reloadCategories().catch(() => {})}>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {categories.map((cat) => (
                <Link key={cat.id} to={categoryPath(cat.id)} className="group block min-w-0">
                  <div className="aspect-square overflow-hidden">
                    <GooArt variant="tile" cols={4} rows={4} seed={cat.id} />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="font-display h-case text-xl min-w-0 break-words">{cat.name}</span>
                    <span className="linkr" aria-hidden="true">
                      <ArrowRight />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </LoadState>
        </div>
      </section>
    </div>
  );
}
