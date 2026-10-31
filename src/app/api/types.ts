export interface Category {
  id: string
  name: string
  sort: number
  active: boolean
}

export interface CategoryInput {
  name: string
  sort?: number
  active?: boolean
}

export interface Variant {
  id: string
  sku: string
  size: string
  color: string
  stock: number
}

export interface Product {
  id: string
  slug: string
  name: string
  category: string
  price: number
  description: string
  image: string
  images: string[]
  sizes: string[]
  colors: string[]
  /** The sum of the variants' stock. */
  stock: number
  active: boolean
  createdAt: string
  variants: Variant[]
}

/** Fields an admin edits. `stock` is a starting total for new products; the server splits it. */
export type ProductInput = Omit<Product, 'id' | 'slug' | 'createdAt' | 'image' | 'variants' | 'active'> & {
  active?: boolean
}

/** One variant's new stock. `expectedStock` makes a stale write fail with 409. */
export interface VariantStockUpdate {
  id: string
  stock: number
  expectedStock?: number
}

/** Body of a 409 from PUT /products/:id. */
export interface StockConflict {
  error: string
  stock: number
  variants?: { id: string; stock: number }[]
}

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
  /** Stock of the matched variant. */
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
  email?: string
}

export type DeliveryMethod = 'door' | 'locker' | 'collect'

export interface DeliveryAddress {
  line1: string
  line2?: string
  suburb: string
  city: string
  postalCode: string
}

/** What the customer chooses. The fee is not sent: the server reads it from the delivery option. */
export interface DeliveryInput {
  method: DeliveryMethod
  address?: DeliveryAddress
  locker?: string
}

export interface DeliveryOption {
  id: string
  name: string
  price: number
}

/** The delivery stored on a placed order. */
export interface OrderDelivery {
  method: string
  address?: DeliveryAddress
  locker?: string
  fee: number
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

export type OrderStatus =
  | 'pending'
  | 'cancelled'
  | 'awaiting_payment'
  | 'paid'
  | 'packed'
  | 'shipped'
  | 'delivered'
  | 'expired'
  | 'refunded'

export interface Order {
  id: string
  ref: string
  createdAt: string
  status: OrderStatus
  lines: OrderLine[]
  /** Includes `deliveryFee`. */
  total: number
  customer: Customer
  /** Missing on orders read from an older server; null when empty. */
  deliveryFee?: number
  delivery?: OrderDelivery | null
  /** How the customer chose to pay; null on orders from before online payment. */
  paymentMethod?: 'whatsapp' | 'online' | null
  /** Set by the server when a payment needs a manual check. */
  paymentFlag?: 'amount_mismatch' | 'refund_due' | null
  /** ISO time the order was marked paid; null until then. */
  paidAt?: string | null
  /** ISO time the order auto-cancels if unpaid; null when it does not expire. */
  expiresAt?: string | null
}

export interface StockShortfall {
  productId: string
  name: string
  size: string
  color: string
  requested: number
  available: number
}
