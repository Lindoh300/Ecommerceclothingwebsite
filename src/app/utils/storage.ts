import { toast } from "sonner";
import type { Product, Variant } from "../api/types";
import { getCachedProduct } from "../hooks/useProducts";

export type { Product } from "../api/types";

export interface CartLine {
  productId: string;
  size?: string;
  color?: string;
  quantity: number;
}

const CART_KEY = "clothing_store_cart_v2";
const OLD_CART_KEY = "clothing_store_cart";

const isQuotaError = (e: unknown): boolean =>
  e instanceof DOMException && e.name === "QuotaExceededError";

// Returns false, and shows a toast if the browser storage is full.
const saveCart = (cart: CartLine[]): boolean => {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    return true;
  } catch (e) {
    if (isQuotaError(e)) {
      toast.error("Could not save your cart", {
        description: "Browser storage is full. Clear some site data and try again.",
      });
    }
    return false;
  }
};

const parseLines = (raw: string | null): CartLine[] | null => {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartLine[]) : [];
  } catch {
    return [];
  }
};

// Moves the old cart ({id, quantity, selectedSize, selectedColor, ...}) into v2 lines.
const migrateOldCart = (): CartLine[] | null => {
  let raw: string | null;
  try {
    raw = localStorage.getItem(OLD_CART_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let lines: CartLine[] = [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      lines = parsed
        .filter((item) => item && typeof item === "object" && item.id != null)
        .map((item) => ({
          productId: String(item.id),
          size: item.selectedSize || undefined,
          color: item.selectedColor || undefined,
          quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
        }));
    }
  } catch {
    lines = [];
  }
  if (saveCart(lines)) {
    try {
      localStorage.removeItem(OLD_CART_KEY);
    } catch {
      // ignore
    }
  }
  return lines;
};

export const getCart = (): CartLine[] => {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CART_KEY);
  } catch {
    return [];
  }
  if (raw === null) {
    const migrated = migrateOldCart();
    return migrated ?? [];
  }
  return parseLines(raw) ?? [];
};

// The variant of a product for a size and colour. A missing size or colour matches
// a variant whose size or colour is ''. Undefined if there is no such variant.
export const findVariant = (product: Pick<Product, "variants">, size?: string, color?: string): Variant | undefined =>
  product.variants?.find((v) => v.size === (size ?? "") && v.color === (color ?? ""));

// Quantity in the cart for one variant (all lines on it). Pass excludeIndex to leave out one
// line, e.g. when that line is being changed.
export const getCartQuantityForVariant = (
  productId: string,
  size?: string,
  color?: string,
  excludeIndex?: number
): number => {
  return getCart().reduce(
    (total, line, index) =>
      line.productId === productId &&
      (line.size ?? "") === (size ?? "") &&
      (line.color ?? "") === (color ?? "") &&
      index !== excludeIndex
        ? total + line.quantity
        : total,
    0
  );
};

// Current stock of a variant from the loaded product list. 0 if the product is not loaded
// or the variant no longer exists.
export const getVariantStock = (productId: string, size?: string, color?: string): number => {
  const product = getCachedProduct(productId);
  return product ? (findVariant(product, size, color)?.stock ?? 0) : 0;
};

// Returns false, and leaves the cart unchanged, if the variant's total would exceed its stock,
// the variant does not exist, or the cart could not be saved.
// Worked check: variant M/Black has stock 3, cart holds 2 of it.
//   addToCart(p, 2, 'M', 'Black') -> 2 + 2 = 4 > 3, returns false.
//   addToCart(p, 1, 'M', 'Black') -> 2 + 1 = 3, not > 3, returns true.
// Other variants of the same product do not count against it.
export const addToCart = (product: Product, quantity: number = 1, size?: string, color?: string): boolean => {
  const variant = findVariant(getCachedProduct(product.id) ?? product, size, color);
  if (!variant) return false;
  if (getCartQuantityForVariant(product.id, size, color) + quantity > variant.stock) {
    return false;
  }

  const cart = getCart();
  const existingIndex = cart.findIndex(
    (line) => line.productId === product.id && line.size === size && line.color === color
  );

  if (existingIndex !== -1) {
    cart[existingIndex].quantity += quantity;
  } else {
    cart.push({ productId: product.id, size, color, quantity });
  }

  if (!saveCart(cart)) return false;
  window.dispatchEvent(new Event("cartUpdated"));
  return true;
};

// Lowering a quantity is always allowed, even if the variant has gone or sold down.
export const updateCartItem = (index: number, quantity: number): boolean => {
  const cart = getCart();
  const line = cart[index];
  if (!line) return false;
  if (quantity > line.quantity) {
    const others = getCartQuantityForVariant(line.productId, line.size, line.color, index);
    if (others + quantity > getVariantStock(line.productId, line.size, line.color)) {
      return false;
    }
  }
  cart[index].quantity = quantity;
  return saveCart(cart);
};

export const removeFromCart = (index: number): void => {
  saveCart(getCart().filter((_, i) => i !== index));
};

export const clearCart = (): void => {
  saveCart([]);
};

export const getCartCount = (): number => {
  return getCart().reduce((count, line) => count + line.quantity, 0);
};
