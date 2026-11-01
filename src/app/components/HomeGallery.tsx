import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Category, Product } from "../api/types";
import { shop, whatsappLink } from "../config/shop";
import { ProductGrid } from "./ProductGrid";
import { ProductSearch } from "./ProductSearch";
import { LoadState } from "./common";
import { CategoryMosaic, DropTile, HearItFirst, NextEvent, OrderYourWay, Ticker } from "./HomeTiles";

const DEFAULT_PLACEHOLDER = "Search products";
const STEP_MS = 2400;

interface HomeGalleryProps {
  products: Product[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<unknown>;
  categories: Category[];
  categoriesLoading: boolean;
  categoriesError: string | null;
  reloadCategories: () => Promise<unknown>;
  featured: Product[];
}

export function HomeGallery({
  products,
  loading,
  error,
  reload,
  categories,
  categoriesLoading,
  categoriesError,
  reloadCategories,
  featured,
}: HomeGalleryProps) {
  const [placeholder, setPlaceholder] = useState(DEFAULT_PLACEHOLDER);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());

  // Step through the category names once, then settle back on the default. Browser APIs only in the effect.
  const names = categories.filter((c) => c.active !== false).map((c) => c.name);
  const namesKey = names.join("\n");
  useEffect(() => {
    if (!namesKey) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const list = namesKey.split("\n");
    let i = 0;
    const timer = window.setInterval(() => {
      if (i < list.length) {
        setPlaceholder(`Search for ${list[i].toLowerCase()}`);
        i += 1;
      } else {
        setPlaceholder(DEFAULT_PLACEHOLDER);
        window.clearInterval(timer);
      }
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, [namesKey]);

  const markFailed = (src: string) => setFailed((prev) => new Set(prev).add(src));
  // The first featured product is the hero tile; the photo stack takes the next ones.
  const stackImages = featured
    .slice(1)
    .filter((p) => p.image && !failed.has(p.image))
    .slice(0, 2);
  const showTile = loading || featured.length > 0;

  return (
    <div>
      <section className={`gallery-hero hero-split${showTile ? "" : " hero-solo"}`}>
        <div className="hero-copy">
          <h1 className="display gallery-hero-title">
            Find your
            <br />
            next fit
            {stackImages.length > 0 && (
              <span className="gallery-hero-stack" aria-hidden="true">
                {stackImages.map((p) => (
                  <img key={p.id} src={p.image} alt="" onError={() => markFailed(p.image)} />
                ))}
              </span>
            )}
          </h1>
          <ProductSearch placeholder={placeholder} />
          <div className="gallery-hero-actions">
            <Link to="/shop" className="cta">Shop all</Link>
            <a
              href={whatsappLink(`Hi ${shop.name}, I would like to ask about your clothing.`)}
              target="_blank"
              rel="noopener noreferrer"
              className="cta cta-quiet"
            >
              Ask on WhatsApp
            </a>
          </div>
          <p className="gallery-hero-note">Premium quality clothing for every occasion. Shop online, or message us on WhatsApp to order. We deliver across South Africa.</p>
        </div>
        {showTile && <DropTile product={featured[0]} />}
      </section>

      <Ticker />

      <NextEvent />

      <section className="gallery-section">
        <div className="max-w-[1360px] mx-auto">
          <div className="sec-head">
            <h2 className="display h-sec">Shop by category</h2>
            <Link to="/shop" className="cta cta-quiet">All products</Link>
          </div>
          <LoadState loading={categoriesLoading} error={categoriesError} onRetry={() => reloadCategories().catch(() => {})}>
            <CategoryMosaic categories={categories} products={products} />
          </LoadState>
        </div>
      </section>

      <section className="gallery-section">
        <div className="max-w-[1360px] mx-auto">
          <div className="sec-head">
            <h2 className="display h-sec">New in</h2>
            <Link to="/shop" className="cta cta-quiet">All products</Link>
          </div>
          <LoadState loading={loading} error={error} onRetry={() => reload().catch(() => {})}>
            {featured.length === 0 ? (
              <div className="r-card border border-b10 p-8 text-center">
                <p className="text-b60">No products to show yet.</p>
              </div>
            ) : (
              <ProductGrid products={featured} />
            )}
          </LoadState>
        </div>
      </section>

      <OrderYourWay />

      <HearItFirst />
    </div>
  );
}
