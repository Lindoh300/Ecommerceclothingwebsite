import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { getProducts } from "../utils/storage";
import { ProductCard } from "./ProductCard";
import { GooArt, Ticker } from "./prism";

const categories = [
  { name: "T-Shirts", path: "/tshirts" },
  { name: "Jerseys", path: "/jerseys" },
  { name: "Shorts", path: "/shorts" },
  { name: "Pants", path: "/pants" },
  { name: "Accessories", path: "/accessories" },
];

const tickerItems = [
  "Premium quality clothing",
  "T-Shirts",
  "Jerseys",
  "Shorts",
  "Pants",
  "Accessories",
  "Order on WhatsApp",
  "Delivery across South Africa",
];

const bigTickerItems = ["4Nguru", "Wear it loud", "Made to move", "The brand"];

const heroMetas = [
  { pos: "top-6 left-6", label: "Est.", value: "Since 2014", right: false },
  { pos: "top-6 right-6 text-right items-end", label: "Based in", value: "South Africa", right: true },
  { pos: "bottom-6 left-6", label: "Ordering", value: "Via WhatsApp", right: false },
  { pos: "bottom-6 right-6 text-right items-end", label: "Collection", value: "SS '26", right: true },
];

export function Home() {
  const featuredProducts = getProducts().slice(0, 100);

  return (
    <div className="min-h-screen overflow-x-hidden">
      {/* Hero */}
      <section className="relative px-6 py-6 md:py-20">
        {heroMetas.map((m) => (
          <div key={m.label} className={`hidden md:flex absolute z-10 flex-col uppercase ${m.pos}`}>
            <small className="text-xs">{m.label}</small>
            <strong className="text-lg font-normal">{m.value}</strong>
          </div>
        ))}
        <div className="max-w-[1280px] mx-auto flex justify-center md:px-[8vw]">
          <div className="relative inline-block leading-[0.9] text-[clamp(72px,20vw,300px)]">
            <h1 className="font-display font-bold uppercase leading-[0.9] tracking-[-0.04em] text-[1em]">
              <span className="sr-only">4Nguru The Brand Online</span>
              <span aria-hidden="true">4NGURU</span>
            </h1>
            <span
              aria-hidden="true"
              className="hand absolute top-1/2 left-1/2 -translate-x-[42%] -translate-y-1/2 whitespace-nowrap pointer-events-none"
              style={{ fontSize: "0.3em" }}
            >
              the brand
            </span>
          </div>
        </div>
      </section>

      <Ticker items={tickerItems} />

      {/* Hero art */}
      <section className="px-6 pt-6">
        <div className="max-w-[1968px] mx-auto relative aspect-square md:aspect-[2/1] overflow-hidden">
          <GooArt variant="hero" cols={12} rows={6} resampleMs={7000} />
          <span className="micro absolute bottom-4 left-4 bg-paper text-ink px-3 py-2">Click to resample</span>
          <div className="absolute bottom-4 right-4">
            <Link to="/tshirts" className="cta">Shop now</Link>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="px-6 py-16 md:py-24">
        <div className="max-w-[1968px] mx-auto">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-10">
            <p className="micro text-b60">01 / Categories</p>
            <h2 className="display h-mid">Shop by category</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {categories.map((cat) => (
              <Link key={cat.path} to={cat.path} className="group block">
                <div className="aspect-square overflow-hidden">
                  <GooArt variant="tile" cols={4} rows={4} seed={cat.path} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="font-display uppercase text-xl">{cat.name}</span>
                  <span className="linkr" aria-hidden="true">
                    <ArrowRight />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <Ticker variant="big" items={bigTickerItems} />

      {/* Featured */}
      <section className="px-6 py-16 md:py-24">
        <div className="max-w-[1968px] mx-auto">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-10">
            <p className="micro text-b60">02 / Featured</p>
            <h2 className="display h-mid">Featured products</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {featuredProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
