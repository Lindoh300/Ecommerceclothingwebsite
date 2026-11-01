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

/** A delivery option as the admin sees it: inactive ones too. */
export interface DeliveryOptionAdmin extends DeliveryOption {
  sort: number
  active: boolean
}

/** What the admin saves for a delivery option. */
export interface DeliveryOptionInput {
  name: string
  price: number
  active: boolean
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
  /** The variant's SKU. Missing on orders placed before the catalogue migration. */
  sku?: string
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

/** Courier, tracking number and tracking link of a packed or shipped order. Each is null when not set. */
export interface OrderTracking {
  courier: string | null
  number: string | null
  url: string | null
}

/** What the admin sends for tracking. A missing key keeps the stored value; '' or null clears it. */
export interface TrackingInput {
  courier?: string | null
  number?: string | null
  url?: string | null
}

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
  /** null until the admin adds tracking. */
  tracking?: OrderTracking | null
}

/** An order as the public tracking page sees it: no customer details, address or payment fields. */
export interface PublicOrder {
  id: string
  ref: string
  createdAt: string
  status: OrderStatus
  lines: { name: string; size?: string; color?: string; quantity: number; subtotal: number }[]
  deliveryFee: number
  /** Includes `deliveryFee`. */
  total: number
  /** The method and, for a locker, its name. */
  delivery: { method: string; locker?: string } | null
  tracking: OrderTracking | null
  expiresAt: string | null
  paymentMethod: 'whatsapp' | 'online' | null
}

export interface StockShortfall {
  productId: string
  name: string
  size: string
  color: string
  requested: number
  available: number
}

/** Public shop settings from GET /config. */
export interface ShopConfig {
  onlinePayments: boolean
}

export type PaymentMethod = 'whatsapp' | 'online'

// --- Events and tickets ----------------------------------------------------------------------------------------

export interface PublicTicketType {
  id: string
  name: string
  price: number
  /** Capacity minus sold, never below 0. */
  available: number
  onSale: boolean
}

export interface PublicEvent {
  id: string
  slug: string
  title: string
  description: string
  startsAt: string
  endsAt: string | null
  venue: string
  city: string
  image: string
  ticketTypes: PublicTicketType[]
}

export interface TicketHolder {
  name: string
  phone: string
  email?: string
}

/** Customer-facing view of one ticket. Only the holder's first name. */
export interface PublicTicket {
  eventTitle: string
  eventSlug: string
  startsAt: string
  venue: string
  city: string
  ticketTypeName: string
  holderFirstName: string
  status: 'valid' | 'used' | 'void'
  checkedInAt: string | null
}

export type EventStatus = 'draft' | 'published' | 'cancelled'

export interface AdminTicketType extends PublicTicketType {
  eventId: string
  capacity: number
  sold: number
  saleStartsAt: string | null
  saleEndsAt: string | null
  active: boolean
  sort: number
}

export interface AdminEvent extends Omit<PublicEvent, 'ticketTypes'> {
  status: EventStatus
  createdAt: string
  ticketTypes: AdminTicketType[]
}

/** A missing key keeps the stored value; `endsAt: null` clears the end. */
export interface EventInput {
  title?: string
  description?: string
  startsAt?: string
  endsAt?: string | null
  venue?: string
  city?: string
  image?: string
  status?: EventStatus
}

export interface TicketTypeInput {
  /** Needed on create. */
  eventId?: string
  name?: string
  price?: number
  capacity?: number
  saleStartsAt?: string | null
  saleEndsAt?: string | null
  active?: boolean
  sort?: number
}

/** The full ticket record, holder details included. Admin only. */
export interface AdminTicket {
  id: string
  code: string
  groupId: string
  eventId: string
  eventTitle: string
  eventSlug: string
  startsAt: string
  venue: string
  city: string
  ticketTypeId: string
  ticketTypeName: string
  holderName: string
  holderPhone: string
  holderEmail: string | null
  source: 'rsvp' | 'issued'
  checkedInAt: string | null
  voidedAt: string | null
  createdAt: string
}

export type CheckInResultName = 'ok' | 'already' | 'void' | 'not_found' | 'wrong_event'

export interface CheckInResponse {
  result: CheckInResultName
  ticket?: AdminTicket
  checkedInAt?: string | null
}

// --- Community: gallery and mailing list ---

export type SubscriberSource = 'community' | 'footer' | 'event'

/** A gallery photo as the public sees it. */
export interface PublicGalleryItem {
  id: string
  image: string
  caption: string
  eventId: string | null
}

export interface AdminGalleryItem extends PublicGalleryItem {
  sort: number
  active: boolean
  createdAt: string
}

/** A missing key keeps the stored value; `eventId: null` clears the link. A new item needs `image`. */
export interface GalleryInput {
  image?: string
  caption?: string
  eventId?: string | null
  sort?: number
  active?: boolean
}

/** A mailing-list subscriber, for the owner. */
export interface Subscriber {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  source: SubscriberSource
  consentAt: string
  unsubscribedAt: string | null
  createdAt: string
}

/** A customer waiting to hear that a sold-out variant is back, for the owner. Oldest first from the server. */
export interface RestockRequest {
  id: string
  productId: string
  productName: string
  productSlug: string
  variantId: string
  size: string
  color: string
  /** The variant's stock now; above 0 means it is back. */
  stock: number
  phone: string | null
  email: string | null
  createdAt: string
}

/** One email sent to the mailing list, as the owner sees it. `pending` is what is still to send. */
export interface ListSendSummary {
  id: string
  subject: string
  body: string
  total: number
  pending: number
  sending: number
  sent: number
  failed: number
  skipped: number
  createdAt: string
  /** null until no recipient is pending or sending. */
  finishedAt: string | null
}

/** A customer as the owner sees them, one row per phone number. `spent` is in Rand. Newest last order first. */
export interface CustomerSummary {
  phone: string
  name: string
  email: string | null
  orders: number
  spent: number
  lastOrderAt: string
  subscribed: boolean
}
