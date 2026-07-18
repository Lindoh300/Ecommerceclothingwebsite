export interface Product {
  id: string;
  name: string;
  category: 'tshirts' | 'jerseys' | 'shorts' | 'pants' | 'accessories';
  price: number;
  description: string;
  image: string;
  images: string[];
  sizes: string[];
  colors: string[];
  stock: number;
}

export interface CartItem extends Product {
  quantity: number;
  selectedSize?: string;
  selectedColor?: string;
}

const PRODUCTS_KEY = 'clothing_store_products';
const CART_KEY = 'clothing_store_cart';

// Initialize with sample products
const defaultProducts: Product[] = [
  {
    id: '1',
    name: 'Classic Cotton T-Shirt',
    category: 'tshirts',
    price: 25,
    description: 'Comfortable 100% cotton t-shirt perfect for everyday wear',
    image: '/images/products/tshirt1.jpg',
    images: ['/images/products/tshirt1.jpg', '', ''],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    colors: ['Black', 'White', 'Navy', 'Gray'],
    stock: 50
  },
  {
    id: '2',
    name: 'Premium Sports Jersey',
    category: 'jerseys',
    price: 45,
    description: 'Breathable sports jersey with moisture-wicking technology',
    image: '/images/products/jersey1.jpg',
    images: ['/images/products/jersey1.jpg', '', ''],
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['Red', 'Blue', 'Green'],
    stock: 30
  },
  {
    id: '3',
    name: 'Athletic Shorts',
    category: 'shorts',
    price: 30,
    description: 'Lightweight shorts ideal for workouts and sports',
    image: '/images/products/shorts1.jpg',
    images: ['/images/products/shorts1.jpg', '', ''],
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['Black', 'Navy', 'Gray'],
    stock: 40
  },
  {
    id: '4',
    name: 'Casual Jogger Pants',
    category: 'pants',
    price: 50,
    description: 'Comfortable jogger pants with elastic waistband',
    image: '/images/products/pants1.jpg',
    images: ['/images/products/pants1.jpg', '', ''],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    colors: ['Black', 'Gray', 'Khaki'],
    stock: 35
  },
  {
    id: '5',
    name: 'Baseball Cap',
    category: 'accessories',
    price: 20,
    description: 'Adjustable baseball cap with embroidered logo',
    image: '/images/products/cap1.jpg',
    images: ['/images/products/cap1.jpg', '', ''],
    sizes: ['One Size'],
    colors: ['Black', 'Navy', 'White', 'Red'],
    stock: 60
  }
];

export const getProducts = (): Product[] => {
  const stored = localStorage.getItem(PRODUCTS_KEY);
  if (!stored) {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(defaultProducts));
    return defaultProducts;
  }
  return JSON.parse(stored);
};

export const getProductById = (id: string): Product | undefined => {
  return getProducts().find(p => p.id === id);
};

export const getProductsByCategory = (category: string): Product[] => {
  return getProducts().filter(p => p.category === category);
};

export const addProduct = (product: Omit<Product, 'id'>): Product => {
  const products = getProducts();
  const newProduct = {
    ...product,
    id: Date.now().toString()
  };
  products.push(newProduct as Product);
  try {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      alert('Storage quota exceeded. Please use smaller images or delete existing products. For professional use, connecting a database like Supabase is recommended.');
    }
    throw e;
  }
  return newProduct as Product;
};

export const updateProduct = (id: string, updates: Partial<Product>): void => {
  const products = getProducts();
  const index = products.findIndex(p => p.id === id);
  if (index !== -1) {
    products[index] = { ...products[index], ...updates };
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
  }
};

export const deleteProduct = (id: string): void => {
  const products = getProducts().filter(p => p.id !== id);
  localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
};

export const getCart = (): CartItem[] => {
  const stored = localStorage.getItem(CART_KEY);
  return stored ? JSON.parse(stored) : [];
};

export const addToCart = (product: Product, quantity: number = 1, size?: string, color?: string): void => {
  const cart = getCart();
  const existingIndex = cart.findIndex(
    item => item.id === product.id && item.selectedSize === size && item.selectedColor === color
  );

  if (existingIndex !== -1) {
    cart[existingIndex].quantity += quantity;
  } else {
    cart.push({ ...product, quantity, selectedSize: size, selectedColor: color });
  }

  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event('cartUpdated'));
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      alert('Cart is full. This usually happens when product data (including large images) exceeds the browser storage limit. Consider reducing the number of products or using a real database.');
    }
    throw e;
  }
};

export const updateCartItem = (index: number, quantity: number): void => {
  const cart = getCart();
  if (cart[index]) {
    cart[index].quantity = quantity;
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }
};

export const removeFromCart = (index: number): void => {
  const cart = getCart().filter((_, i) => i !== index);
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
};

export const clearCart = (): void => {
  localStorage.setItem(CART_KEY, JSON.stringify([]));
};

export const getCartTotal = (): number => {
  return getCart().reduce((total, item) => total + (item.price * item.quantity), 0);
};

export const getCartCount = (): number => {
  return getCart().reduce((count, item) => count + item.quantity, 0);
};
