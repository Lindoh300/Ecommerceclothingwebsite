import { useParams, useNavigate } from "react-router";
import { useState } from "react";
import { getProductById, addToCart } from "../utils/storage";
import { ShoppingCart, ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { toast } from "sonner";

export function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const product = getProductById(id || '');

  const [selectedSize, setSelectedSize] = useState('');
  const [selectedColor, setSelectedColor] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const galleryImages = (product?.images ?? []).filter(Boolean);
  const totalImages = galleryImages.length;

  const goToPrev = () => setActiveImageIndex((i) => (i - 1 + totalImages) % totalImages);
  const goToNext = () => setActiveImageIndex((i) => (i + 1) % totalImages);

  if (!product) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl mb-4">Product not found</h2>
          <Button onClick={() => navigate('/')}>Go Home</Button>
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

    addToCart(product, quantity, selectedSize || product.sizes[0], selectedColor || product.colors[0]);
    window.dispatchEvent(new Event('cartUpdated'));
    toast.success('Added to cart!', {
      description: `${quantity} × ${product.name}`
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <Button
          onClick={() => navigate(-1)}
          variant="ghost"
          className="mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="grid md:grid-cols-2 gap-8 p-8">
            {/* Product Image Gallery */}
            <div className="flex flex-col gap-3">
              {/* Main Image */}
              <div className="relative aspect-square bg-gray-100 rounded-xl overflow-hidden border border-gray-200 shadow-sm">
                <img
                  key={activeImageIndex}
                  src={product.images?.[activeImageIndex] || product.image}
                  alt={product.name}
                  className="w-full h-full object-cover transition-opacity duration-300"
                  onError={(e) => {
                    e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="400"%3E%3Crect fill="%23e5e7eb" width="400" height="400"/%3E%3Ctext fill="%236b7280" font-family="sans-serif" font-size="24" x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle"%3ENo Image%3C/text%3E%3C/svg%3E';
                  }}
                />
                {/* Arrow navigation */}
                {totalImages > 1 && (
                  <>
                    <button
                      onClick={goToPrev}
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white text-gray-800 rounded-full p-2 shadow-md backdrop-blur-sm transition-all hover:scale-105 active:scale-95"
                      aria-label="Previous image"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      onClick={goToNext}
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white text-gray-800 rounded-full p-2 shadow-md backdrop-blur-sm transition-all hover:scale-105 active:scale-95"
                      aria-label="Next image"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </>
                )}

                {/* View label badge */}
                {totalImages > 1 && (
                  <span className="absolute bottom-3 right-3 bg-black/50 text-white text-xs px-2 py-1 rounded-full backdrop-blur-sm">
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
                      className={`group relative aspect-square rounded-lg overflow-hidden border-2 transition-all duration-200 ${
                        isActive
                          ? 'border-blue-600 ring-2 ring-blue-100 shadow-md'
                          : 'border-gray-200 hover:border-blue-400 hover:shadow-sm'
                      }`}
                    >
                      <img
                        src={img}
                        alt={`${product.name} — ${views[index]}`}
                        className="w-full h-full object-cover"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                      <div className={`absolute inset-x-0 bottom-0 py-1 text-center text-[10px] font-medium transition-colors ${
                        isActive ? 'bg-blue-600 text-white' : 'bg-black/40 text-white group-hover:bg-blue-600'
                      }`}>
                        {views[index]}
                      </div>
                    </button>
                  ) : (
                    <div
                      key={index}
                      className="aspect-square rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 flex flex-col items-center justify-center gap-1"
                    >
                      <span className="text-gray-300 text-xl">+</span>
                      <span className="text-[10px] text-gray-400">{views[index]}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Product Info */}
            <div>
              <h1 className="text-3xl mb-4">{product.name}</h1>
              <p className="text-2xl text-blue-600 mb-4">R{product.price}</p>
              <p className="text-gray-600 mb-6">{product.description}</p>

              {/* Size Selection */}
              {product.sizes.length > 0 && (
                <div className="mb-6">
                  <label className="block mb-2">Size</label>
                  <div className="flex flex-wrap gap-2">
                    {product.sizes.map(size => (
                      <button
                        key={size}
                        onClick={() => setSelectedSize(size)}
                        className={`px-4 py-2 border rounded-lg transition-colors ${
                          selectedSize === size
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-700 border-gray-300 hover:border-blue-600'
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
                <div className="mb-6">
                  <label className="block mb-2">Color</label>
                  <div className="flex flex-wrap gap-2">
                    {product.colors.map(color => (
                      <button
                        key={color}
                        onClick={() => setSelectedColor(color)}
                        className={`px-4 py-2 border rounded-lg transition-colors ${
                          selectedColor === color
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-700 border-gray-300 hover:border-blue-600'
                        }`}
                      >
                        {color}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Quantity */}
              <div className="mb-6">
                <label className="block mb-2">Quantity</label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100"
                  >
                    -
                  </button>
                  <span className="px-4 py-2 border border-gray-300 rounded-lg min-w-[60px] text-center">
                    {quantity}
                  </span>
                  <button
                    onClick={() => setQuantity(Math.min(product.stock, quantity + 1))}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100"
                  >
                    +
                  </button>
                </div>
                <p className="text-sm text-gray-500 mt-2">{product.stock} available</p>
              </div>

              {/* Add to Cart */}
              <Button
                onClick={handleAddToCart}
                className="w-full py-6"
                disabled={product.stock === 0}
              >
                <ShoppingCart className="w-5 h-5 mr-2" />
                {product.stock === 0 ? 'Out of Stock' : 'Add to Cart'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
