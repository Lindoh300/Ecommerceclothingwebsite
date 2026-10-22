import { Link } from "react-router";
import type { Product } from "../api/types";
import { ProductImage } from "./prism";

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  return (
    <Link to={`/product/${product.id}`} className="group block">
      <div className="aspect-square bg-b5 overflow-hidden">
        <div className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]">
          <ProductImage src={product.image} alt={product.name} seed={product.id} />
        </div>
      </div>
      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="uppercase font-medium text-[15px]">{product.name}</h3>
          <span className="font-mono shrink-0">R{product.price}</span>
        </div>
        <p className="text-b60 text-sm mt-1 line-clamp-2">{product.description}</p>
        {product.stock > 0 ? (
          <p className="micro text-b60 mt-2">{product.stock} in stock</p>
        ) : (
          <p className="micro text-prism mt-2">Sold out</p>
        )}
      </div>
    </Link>
  );
}
