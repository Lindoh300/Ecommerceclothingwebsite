import { useParams, useNavigate } from "react-router";
import { useEffect, useState } from "react";
import { addToCart, findVariant, getCart } from "../utils/storage";
import type { CartLine } from "../utils/storage";
import type { Product } from "../api/types";
import { ShoppingCart, ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "../lib/toast";
import { useProduct, useProducts } from "../hooks/useProducts";
import { useCategories } from "../hooks/useCategories";
import { ProductImage } from "./prism/ProductImage";
import { LoadState } from "./prism/LoadState";

const LOW_STOCK_LIMIT = 3;

// Struck through and disabled when the option has no stock; the text stays for screen readers.
const optionClass = (selected: boolean) =>
  `min-w-[48px] px-4 py-2 border text-sm transition-colors disabled:cursor-not-allowed disabled:border-b10 disabled:bg-b5 disabled:text-b60 disabled:line-through ${
    selected ? 'bg-ink text-paper border-ink' : 'bg-paper text-ink border-b10 hover:border-ink'
  }`;

interface ProductDetailProps {
  /** Product the route loader fetched on the server. Shown until the shared product list loads. */
  initialProduct?: Product | null;
  /** The loader found no such product (the page is sent with status 404). */
  notFound?: boolean;
}

export function ProductDetail({ initialProduct = null, notFound = false }: ProductDetailProps = {}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { product: loadedProduct, loading, error } = useProduct(id);
  const product = loadedProduct ?? initialProduct ?? undefined;
  const { reload } = useProducts();
  const { categories } = useCategories();

  const [selectedSize, setSelectedSize] = useState('');
  const [selectedColor, setSelectedColor] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  // The cart is browser-only, so it is read after mount (empty on the server and in the first
  // client render, which keeps hydration identical) and again whenever it changes. The quantity
  // limit counts what is already in it.
  const [cartLines, setCartLines] = useState<CartLine[]>([]);
  useEffect(() => {
    const onChange = () => setCartLines(getCart());
    onChange();
    window.addEventListener('cartUpdated', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('cartUpdated', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  const galleryImages = (product?.images ?? []).filter(Boolean);
  const totalImages = galleryImages.length;

  const goToPrev = () => setActiveImageIndex((i) => (i - 1 + totalImages) % totalImages);
  const goToNext = () => setActiveImageIndex((i) => (i + 1) % totalImages);

  // A product with one size or one colour selects it for the customer.
  const size = product?.sizes.length === 1 ? product.sizes[0] : selectedSize;
  const color = product?.colors.length === 1 ? product.colors[0] : selectedColor;
  const sizeChosen = !product || product.sizes.length === 0 || !!size;
  const colorChosen = !product || product.colors.length === 0 || !!color;
  const variantStock = (sz: string, cl: string) => (product ? (findVariant(product, sz, cl)?.stock ?? 0) : 0);
  // A size is out when it has no stock in the chosen colour (or in any colour, if none is chosen), and vice versa.
  const sizeOut = (sz: string) =>
    color || (product?.colors.length ?? 0) === 0
      ? variantStock(sz, color) <= 0
      : (product?.colors ?? []).every((cl) => variantStock(sz, cl) <= 0);
  const colorOut = (cl: string) =>
    size || (product?.sizes.length ?? 0) === 0
      ? variantStock(size, cl) <= 0
      : (product?.sizes ?? []).every((sz) => variantStock(sz, cl) <= 0);
  const optionsChosen = sizeChosen && colorChosen;
  const selectedVariant = product && optionsChosen ? findVariant(product, size, color) : undefined;
  const selectedStock = selectedVariant?.stock ?? 0;
  const inCart =
    product && optionsChosen
      ? cartLines.reduce(
          (total, line) =>
            line.productId === product.id && (line.size ?? "") === size && (line.color ?? "") === color
              ? total + line.quantity
              : total,
          0,
        )
      : 0;
  const remaining = Math.max(0, selectedStock - inCart);
  const shownQuantity = Math.max(1, Math.min(quantity, remaining));
  const soldOut = !!product && (product.variants?.length ? product.variants.every((v) => v.stock <= 0) : product.stock <= 0);
  const categoryName = categories.find((c) => c.id === product?.category)?.name ?? product?.category;

  if (!product && !notFound && (loading || error)) {
    return (
      <div className="min-h-screen bg-paper py-12 md:py-16">
        <div className="max-w-[1968px] mx-auto px-6">
          <LoadState loading={loading} error={error} onRetry={() => reload().catch(() => {})}>
            {null}
          </LoadState>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-paper py-12 md:py-16">
        <div className="max-w-[1968px] mx-auto px-6 text-center">
          <h2 className="display h-mid mb-8">Product not found</h2>
          <button onClick={() => navigate('/')} className="cta">Go Home</button>
        </div>
      </div>
    );
  }

  const handleAddToCart = () => {
    if (!sizeChosen) {
      toast.error('Please select a size');
      return;
    }
    if (!colorChosen) {
      toast.error('Please select a color');
      return;
    }

    const added = addToCart(product, shownQuantity, size || undefined, color || undefined);
    if (!added) {
      toast.error('Not enough stock', {
        description: inCart > 0
          ? `Only ${selectedStock} available and you already have ${inCart} in your cart.`
          : `Only ${selectedStock} available.`
      });
      return;
    }
    window.dispatchEvent(new Event('cartUpdated'));
    toast.success('Added to cart!', {
      description: `${shownQuantity} × ${product.name}`
    });
  };

  return (
    <div className="min-h-screen bg-paper py-12 md:py-16">
      <div className="max-w-[1968px] mx-auto px-6">
        <button
          onClick={() => navigate(-1)}
          className="linkr text-ink mb-10"
        >
          <ArrowLeft className="w-3 h-3" />
          Back
        </button>

        <div className="grid md:grid-cols-2 gap-10 md:gap-16">
          {/* Product Image Gallery */}
          <div className="flex flex-col gap-3">
            {/* Main Image */}
            <div className="relative aspect-square bg-b5 overflow-hidden r-card">
              <ProductImage
                key={activeImageIndex}
                src={product.images?.[activeImageIndex] || product.image}
                alt={product.name}
                seed={product.id}
              />
              {/* Arrow navigation */}
              {totalImages > 1 && (
                <>
                  <button
                    onClick={goToPrev}
                    className="absolute left-3 top-1/2 -translate-y-1/2 bg-paper hover:bg-prism hover:text-on-accent text-ink border border-b10 p-2 transition-colors"
                    aria-label="Previous image"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={goToNext}
                    className="absolute right-3 top-1/2 -translate-y-1/2 bg-paper hover:bg-prism hover:text-on-accent text-ink border border-b10 p-2 transition-colors"
                    aria-label="Next image"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}

              {/* View label badge */}
              {totalImages > 1 && (
                <span className="absolute bottom-3 right-3 bg-ink text-paper font-mono text-xs px-2 py-1">
                  {activeImageIndex + 1} / {totalImages}
                </span>
              )}
            </div>

            {/* Thumbnail Strip — always show 3 slots */}
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((index) => {
                const img = product.images?.[index];
                const isActive = activeImageIndex === index;
                const views = ['Front view', 'Back view', 'Side view'];
                return img ? (
                  <button
                    key={index}
                    onClick={() => setActiveImageIndex(index)}
                    className={`group relative aspect-square overflow-hidden border transition-colors duration-200 ${
                      isActive
                        ? 'border-ink'
                        : 'border-b10 hover:border-prism'
                    }`}
                  >
                    <ProductImage src={img} alt={`${product.name} — ${views[index]}`} seed={`${product.id}-${index}`} />
                    <div className={`absolute inset-x-0 bottom-0 py-1 text-center font-mono text-[10px] caps transition-colors ${
                      isActive ? 'bg-ink text-paper' : 'bg-scrim/40 text-on-scrim group-hover:bg-prism group-hover:text-on-accent'
                    }`}>
                      {views[index]}
                    </div>
                  </button>
                ) : (
                  <div
                    key={index}
                    className="aspect-square border border-dashed border-b10 flex flex-col items-center justify-center gap-1"
                  >
                    <span className="text-b60 text-xl">+</span>
                    <span className="micro text-b60 text-[10px]">{views[index]}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Product Info */}
          <div>
            <p className="micro text-b60 mb-3">{categoryName}</p>
            <h1 className="display h-mid mb-4">{product.name}</h1>
            <p className="font-mono text-2xl text-ink mb-4">R{product.price}</p>
            <p className="text-b60 mb-8">{product.description}</p>

            {/* Size Selection */}
            {product.sizes.length > 0 && (
              <div className="mb-8" role="group" aria-labelledby="size-label">
                <p id="size-label" className="micro block mb-3">Size</p>
                <div className="flex flex-wrap gap-2">
                  {product.sizes.map(sz => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => setSelectedSize(sz)}
                      disabled={sizeOut(sz)}
                      aria-pressed={size === sz}
                      className={optionClass(size === sz)}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Color Selection */}
            {product.colors.length > 0 && (
              <div className="mb-8" role="group" aria-labelledby="color-label">
                <p id="color-label" className="micro block mb-3">Color</p>
                <div className="flex flex-wrap gap-2">
                  {product.colors.map(cl => (
                    <button
                      key={cl}
                      type="button"
                      onClick={() => setSelectedColor(cl)}
                      disabled={colorOut(cl)}
                      aria-pressed={color === cl}
                      className={optionClass(color === cl)}
                    >
                      {cl}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quantity */}
            <div className="mb-8">
              <label className="micro block mb-3">Quantity</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuantity(Math.max(1, shownQuantity - 1))}
                  aria-label="Decrease quantity"
                  className="w-10 h-10 border border-b10 text-ink hover:border-ink transition-colors"
                >
                  -
                </button>
                <span className="w-12 h-10 border border-b10 flex items-center justify-center font-mono" aria-live="polite">
                  {shownQuantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity(Math.min(Math.max(1, remaining), shownQuantity + 1))}
                  disabled={!optionsChosen || shownQuantity >= remaining}
                  aria-label="Increase quantity"
                  className="w-10 h-10 border border-b10 text-ink hover:border-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  +
                </button>
              </div>
              {optionsChosen && selectedStock > 0 && selectedStock <= LOW_STOCK_LIMIT && (
                <p className="micro text-prism mt-3">Only {selectedStock} left</p>
              )}
              {optionsChosen && selectedStock > 0 && remaining === 0 && (
                <p className="micro text-b60 mt-3">You have all available in your cart</p>
              )}
            </div>

            {/* Add to Cart */}
            <button
              type="button"
              onClick={handleAddToCart}
              className="cta w-full"
              disabled={soldOut || !optionsChosen || remaining === 0}
            >
              <ShoppingCart className="w-5 h-5" />
              {soldOut ? 'Out of Stock' : 'Add to Cart'}
            </button>
            {!soldOut && !optionsChosen && (
              <p className="micro text-b60 mt-3">
                Select {!sizeChosen && !colorChosen ? 'a size and a color' : !sizeChosen ? 'a size' : 'a color'} to add to cart
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
