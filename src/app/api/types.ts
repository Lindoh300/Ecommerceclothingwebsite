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
  available: boolean
}

export interface CartQuote {
  lines: CartQuoteLine[]
  total: number
  missing: string[]
}
