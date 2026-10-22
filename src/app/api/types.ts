export type Category = 'tshirts' | 'jerseys' | 'shorts' | 'pants' | 'accessories'

export interface Product {
  id: string
  name: string
  category: Category
  price: number
  description: string
  image: string
  images: string[]
  sizes: string[]
  colors: string[]
  stock: number
  createdAt: string
}

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'image'>

export interface CartQuoteItem {
  productId: string
  size?: string
  color?: string
  quantity: number
}

export interface CartQuoteLine {
  productId: string
  name: string
  price: number
  image: string
  size?: string
  color?: string
  quantity: number
  subtotal: number
  available: number
}

export interface CartQuote {
  lines: CartQuoteLine[]
  total: number
  missing: string[]
}

export interface Customer {
  name: string
  phone: string
  note?: string
}

export interface OrderLine {
  productId: string
  name: string
  price: number
  size?: string
  color?: string
  quantity: number
  subtotal: number
}

export type OrderStatus = 'pending' | 'cancelled'

export interface Order {
  id: string
  ref: string
  createdAt: string
  status: OrderStatus
  lines: OrderLine[]
  total: number
  customer: Customer
}

export interface StockShortfall {
  productId: string
  name: string
  requested: number
  available: number
}
