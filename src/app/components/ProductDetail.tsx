import { useParams, useNavigate } from "react-router";
import { useState } from "react";
import { addToCart, getCartQuantityForProduct } from "../utils/storage";
import { ShoppingCart, ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useProduct, useProducts } from "../hooks/useProducts";
import { ProductImage } from "./prism/ProductImage";
import { LoadState } from "./prism/LoadState";

const categoryNames: Record<string, string> = {
  tshirts: 'T-Shirts',
  jerseys: 'Jerseys',
  shorts: 'Shorts',
  pants: 'Pants',
  accessories: 'Accessories'
};

export function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { product, loading, error } = useProduct(id);
  const { reload } = useProducts();

  const [selectedSize, setSelectedSize] = useState('');
  const [selectedColor, setSelectedColor] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const galleryImages = (product?.images ?? []).filter(Boolean);
  const totalImages = galleryImages.length;

  const goToPrev = () => setActiveImageIndex((i) => (i - 1 + totalImages) % totalImages);
  const goToNext = () => setActiveImageIndex((i) => (i + 1) % totalImages);

  if (loading || error) {
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
    if (product.sizes.length > 1 && !selectedSize) {
      toast.error('Please select a size');
      return;
    }
    if (product.colors.length > 1 && !selectedColor) {
      toast.error('Please select a color');
      return;
    }

    const added = addToCart(product, quantity, selectedSize || product.sizes[0], selectedColor || product.colors[0]);
    if (!added) {
      const inCart = getCartQuantityForProduct(product.id);
      toast.error('Not enough stock', {
        description: inCart > 0
          ? `Only ${product.stock} available and you already have ${inCart} in your cart.`
          : `Only ${product.stock} available.`
      });
      return;
    }
    window.dispatchEvent(new Event('cartUpdated'));
    toast.success('Added to cart!', {
      description: `${quantity} × ${product.name}`
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
            <div className="relative aspect-square bg-b5 overflow-hidden">
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
                    className="absolute left-3 top-1/2 -translate-y-1/2 bg-white hover:bg-prism hover:text-white text-ink border border-b10 p-2 transition-colors"
                    aria-label="Previous image"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={goToNext}
                    className="absolute right-3 top-1/2 -translate-y-1/2 bg-white hover:bg-prism hover:text-white text-ink border border-b10 p-2 transition-colors"
                    aria-label="Next image"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}

              {/* View label badge */}
              {totalImages > 1 && (
                <span className="absolute bottom-3 right-3 bg-ink text-white font-mono text-xs px-2 py-1">
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
                    <div className={`absolute inset-x-0 bottom-0 py-1 text-center font-mono text-[10px] uppercase transition-colors ${
                      isActive ? 'bg-ink text-white' : 'bg-black/40 text-white group-hover:bg-prism'
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
            <p className="micro text-b60 mb-3">{categoryNames[product.category]}</p>
            <h1 className="display h-mid mb-4">{product.name}</h1>
            <p className="font-mono text-2xl text-ink mb-4">R{product.price}</p>
            <p className="text-b60 mb-8">{product.description}</p>

            {/* Size Selection */}
            {product.sizes.length > 0 && (
              <div className="mb-8">
                <label className="micro block mb-3">Size</label>
                <div className="flex flex-wrap gap-2">
                  {product.sizes.map(size => (
                    <button
                      key={size}
                      onClick={() => setSelectedSize(size)}
                      className={`min-w-[48px] px-4 py-2 border text-sm transition-colors ${
                        selectedSize === size
                          ? 'bg-ink text-white border-ink'
                          : 'bg-white text-ink border-b10 hover:border-ink'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Color Selection */}
            {product.colors.length > 0 && (
              <div className="mb-8">
                <label className="micro block mb-3">Color</label>
                <div className="flex flex-wrap gap-2">
                  {product.colors.map(color => (
                    <button
                      key={color}
                      onClick={() => setSelectedColor(color)}
                      className={`min-w-[48px] px-4 py-2 border text-sm transition-colors ${
                        selectedColor === color
                          ? 'bg-ink text-white border-ink'
                          : 'bg-white text-ink border-b10 hover:border-ink'
                      }`}
                    >
                      {color}
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
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-10 h-10 border border-b10 text-ink hover:border-ink transition-colors"
                >
                  -
                </button>
                <span className="w-12 h-10 border border-b10 flex items-center justify-center font-mono">
                  {quantity}
                </span>
                <button
                  onClick={() => setQuantity(Math.min(product.stock, quantity + 1))}
                  className="w-10 h-10 border border-b10 text-ink hover:border-ink transition-colors"
                >
                  +
                </button>
              </div>
              <p className="micro text-b60 mt-3">{product.stock} available</p>
            </div>

            {/* Add to Cart */}
            <button
              onClick={handleAddToCart}
              className="cta w-full"
              disabled={product.stock === 0}
            >
              <ShoppingCart className="w-5 h-5" />
              {product.stock === 0 ? 'Out of Stock' : 'Add to Cart'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
