import { toast } from "sonner";
import type { Product } from "../api/types";
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

// Total quantity of one product across all of its cart lines (all sizes and colours).
// Pass excludeIndex to leave out one line, e.g. when that line is being changed.
export const getCartQuantityForProduct = (productId: string, excludeIndex?: number): number => {
  return getCart().reduce(
    (total, line, index) => (line.productId === productId && index !== excludeIndex ? total + line.quantity : total),
    0
  );
};

// Current stock from the loaded product list, or the fallback if the product is not loaded.
export const getAvailableStock = (productId: string, fallback = 0): number => {
  return getCachedProduct(productId)?.stock ?? fallback;
};

// Returns false, and leaves the cart unchanged, if the total would exceed stock
// or the cart could not be saved.
// Worked check: stock 3, cart holds 2 of size M.
//   addToCart(p, 2, 'L') -> 2 + 2 = 4 > 3, returns false.
//   addToCart(p, 1, 'L') -> 2 + 1 = 3, not > 3, returns true.
export const addToCart = (product: Product, quantity: number = 1, size?: string, color?: string): boolean => {
  if (getCartQuantityForProduct(product.id) + quantity > getAvailableStock(product.id, product.stock)) {
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

export const updateCartItem = (index: number, quantity: number): boolean => {
  const cart = getCart();
  const line = cart[index];
  if (!line) return false;
  if (getCartQuantityForProduct(line.productId, index) + quantity > getAvailableStock(line.productId)) {
    return false;
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
