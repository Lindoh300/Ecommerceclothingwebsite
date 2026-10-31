import { Link } from "react-router";
import type { Product } from "../api/types";
import { ProductImage } from "./prism";

interface ProductCardProps {
  product: Product;
}

export const LOW_STOCK_TOTAL = 5;

/** Total stock is the sum of the variants' stock, kept on `product.stock` by the server. */
export function stockStatus(product: Pick<Product, "stock" | "variants">): "soldOut" | "low" | "ok" {
  const total = product.variants?.length ? product.variants.reduce((sum, v) => sum + Math.max(0, v.stock), 0) : product.stock;
  if (total <= 0) return "soldOut";
  return total <= LOW_STOCK_TOTAL ? "low" : "ok";
}

/** The "Sold out" / "Low stock" mark. Renders nothing when there is plenty of stock. */
export function StockMark({ product, className = "" }: { product: Pick<Product, "stock" | "variants">; className?: string }) {
  const status = stockStatus(product);
  if (status === "ok") return null;
  return status === "soldOut" ? (
    <span className={`micro inline-flex items-center border border-ink bg-ink px-2 py-1 text-paper ${className}`}>Sold out</span>
  ) : (
    <span className={`micro inline-flex items-center gap-2 border border-status-low bg-paper px-2 py-1 text-ink ${className}`}>
      <span aria-hidden="true" className="h-2 w-2 bg-status-low" />
      Low stock
    </span>
  );
}

export function ProductCard({ product }: ProductCardProps) {
  const soldOut = stockStatus(product) === "soldOut";
  return (
    <Link to={`/product/${product.id}`} className="group block min-w-0">
      <div className="relative aspect-square bg-b5 overflow-hidden r-card">
        <div
          className={`h-full w-full transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100 ${
            soldOut ? "opacity-60" : ""
          }`}
        >
          <ProductImage src={product.image} alt={product.name} seed={product.id} />
        </div>
        <StockMark product={product} className="absolute left-3 top-3" />
      </div>
      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="caps font-medium text-[15px] min-w-0 break-words">{product.name}</h3>
          <span className="font-mono shrink-0">R{product.price}</span>
        </div>
        <p className="text-b60 text-sm mt-1 line-clamp-2">{product.description}</p>
      </div>
    </Link>
  );
}
