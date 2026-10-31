import { Link, useParams, useNavigate } from "react-router";
import { useEffect, useState } from "react";
import { addToCart, findVariant, getCart } from "../utils/storage";
import type { CartLine } from "../utils/storage";
import type { Product } from "../api/types";
import { ShoppingCart, ArrowLeft, ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import { toast } from "../lib/toast";
import { useProduct, useProducts } from "../hooks/useProducts";
import { useCategories } from "../hooks/useCategories";
import { ProductImage } from "./common/ProductImage";
import { LoadState } from "./common/LoadState";
import { StockMark } from "./ProductCard";
import { shop, whatsappLink } from "../config/shop";
import { categoryPath } from "../utils/categoryPath";

const LOW_STOCK_LIMIT = 3;

// Struck through and disabled when the option has no stock; the text stays for screen readers.
const optionClass = (selected: boolean) =>
  `r-chip min-w-[48px] min-h-[44px] px-4 py-2 border text-sm transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:border-b10 disabled:bg-b5 disabled:text-b60 disabled:line-through ${
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

  const askMessage = product
    ? [
        `Hi ${shop.name}, I am interested in ${product.name} (R${product.price}).`,
        size ? `Size: ${size}.` : "",
        color ? `Colour: ${color}.` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  if (!product && !notFound && (loading || error)) {
    return (
      <div className="min-h-screen bg-paper py-12 md:py-16">
        <div className="max-w-[1360px] mx-auto px-6">
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
        <div className="max-w-[1360px] mx-auto px-6 text-center">
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
      <div className="max-w-[1360px] mx-auto px-6">
        <div className="mb-10 flex flex-wrap items-center gap-x-6 gap-y-3">
          <button type="button" onClick={() => navigate(-1)} className="linkr text-ink">
            <ArrowLeft className="w-3 h-3" />
            Back
          </button>
          <nav aria-label="Breadcrumb" className="micro text-b60 min-w-0 break-words">
            <Link to="/shop" className="hover:text-ink">Shop</Link>
            {categoryName && (
              <>
                {" / "}
                <Link to={categoryPath(product.category)} className="hover:text-ink">{categoryName}</Link>
              </>
            )}
          </nav>
        </div>

        <div className="grid md:grid-cols-2 gap-10 md:gap-16 md:items-start">
          {/* Product Image Gallery */}
          <div className="flex flex-col gap-3">
            {/* Main Image */}
            <div className="relative aspect-square bg-b5 overflow-hidden r-card">
              <ProductImage
                key={activeImageIndex}
                src={product.images?.[activeImageIndex] || product.image}
                alt={product.name}
              />
              {/* Arrow navigation */}
              {totalImages > 1 && (
                <>
                  <button
                    onClick={goToPrev}
                    className="absolute left-3 top-1/2 -translate-y-1/2 bg-paper hover:bg-brand hover:text-on-accent text-ink border border-b10 r-chip p-2 transition-colors"
                    aria-label="Previous image"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={goToNext}
                    className="absolute right-3 top-1/2 -translate-y-1/2 bg-paper hover:bg-brand hover:text-on-accent text-ink border border-b10 r-chip p-2 transition-colors"
                    aria-label="Next image"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}

              {/* View label badge */}
              {totalImages > 1 && (
                <span className="absolute bottom-3 right-3 bg-ink text-paper text-xs px-2 py-1 r-chip">
                  {activeImageIndex + 1} / {totalImages}
                </span>
              )}
            </div>

            {/* Thumbnails: one per image the product has */}
            {totalImages > 1 && (
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
                {galleryImages.map((img, index) => {
                  const isActive = activeImageIndex === index;
                  return (
                    <button
                      key={`${img}-${index}`}
                      type="button"
                      onClick={() => setActiveImageIndex(index)}
                      aria-label={`Show image ${index + 1} of ${totalImages}`}
                      aria-pressed={isActive}
                      className={`relative aspect-square overflow-hidden border r-card transition-colors motion-reduce:transition-none ${
                        isActive ? 'border-ink' : 'border-b10 hover:border-brand'
                      }`}
                    >
                      <ProductImage src={img} alt="" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Product Info */}
          <div className="min-w-0 md:sticky md:top-24">
            <p className="page-kicker micro text-b60 mb-3">{categoryName}</p>
            <h1 className="display h-mid mb-4">{product.name}</h1>
            <div className="mb-6 flex flex-wrap items-center gap-4">
              <p className="text-2xl text-ink">R{product.price}</p>
              <StockMark product={product} />
            </div>
            <p className="text-b60 mb-8 whitespace-pre-line">{product.description}</p>

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
                  className="w-10 h-10 border border-b10 r-chip text-ink hover:border-ink transition-colors"
                >
                  -
                </button>
                <span className="w-12 h-10 border border-b10 r-chip flex items-center justify-center" aria-live="polite">
                  {shownQuantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity(Math.min(Math.max(1, remaining), shownQuantity + 1))}
                  disabled={!optionsChosen || shownQuantity >= remaining}
                  aria-label="Increase quantity"
                  className="w-10 h-10 border border-b10 r-chip text-ink hover:border-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  +
                </button>
              </div>
              {optionsChosen && selectedStock > 0 && selectedStock <= LOW_STOCK_LIMIT && (
                <p className="micro text-ink mt-3">Only {selectedStock} left</p>
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

            {/* Ask on WhatsApp: the message names the product and the chosen size and colour. */}
            <a
              href={whatsappLink(askMessage)}
              target="_blank"
              rel="noopener noreferrer"
              className="caps mt-4 flex h-12 w-full items-center justify-center gap-2 border border-ink r-chip px-6 text-sm text-ink transition-colors hover:bg-ink hover:text-paper focus-visible:bg-ink focus-visible:text-paper motion-reduce:transition-none"
            >
              <MessageCircle className="w-5 h-5" aria-hidden="true" />
              Ask on WhatsApp
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
