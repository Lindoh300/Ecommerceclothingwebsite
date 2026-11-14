import type { Mailer } from './mailer.ts';
import type { PaymentProvider } from './payments.ts';

export interface Variant {
  id: string;
  sku: string;
  size: string;
  color: string;
  stock: number;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  /** A category id (slug). The store decides whether it exists. */
  category: string;
  price: number;
  description: string;
  image: string;
  images: string[];
  sizes: string[];
  colors: string[];
  /** The sum of the variants' stock. */
  stock: number;
  active: boolean;
  createdAt: string;
  /** In size then colour order. */
  variants: Variant[];
}

export interface Category {
  id: string;
  name: string;
  sort: number;
  active: boolean;
}

/** The fields an admin edits. `stock` is a total, spread over the variants by the store. */
export interface ProductInput {
  name: string;
  category: string;
  price: number;
  description: string;
  images: string[];
  sizes: string[];
  colors: string[];
  stock: number;
  active: boolean;
}

/** {size, color} may be missing or '' for "no such dimension". */
export interface VariantInput {
  size?: string;
  color?: string;
  stock: number;
}

export interface NewProduct extends Omit<ProductInput, 'stock' | 'active'> {
  id: string;
  /** Total, split evenly over all variants. Ignored when `variants` is given. Default 0. */
  stock?: number;
  /** Each listed size x colour gets that stock, the other combinations get 0. */
  variants?: VariantInput[];
  /** In-memory stores only (seeding). The database function always uses now(). */
  createdAt?: string;
}

/** Sets one variant's stock. With `expectedStock`, a different stored value means nothing is written. */
export interface VariantStockInput {
  id: string;
  stock: number;
  expectedStock?: number;
}

export interface CartQuoteRequest {
  items: { productId: string; size?: string; color?: string; quantity: number }[];
  /** Trimmed and upper-cased by validateQuote; absent when blank. Not checked against DISCOUNT_CODE_RE there. */
  discountCode?: string;
}

export interface CartQuoteLine {
  productId: string;
  name: string;
  price: number;
  image: string;
  size?: string;
  color?: string;
  quantity: number;
  subtotal: number;
  /** Stock of the matched variant. */
  available: number;
  variantId: string;
  sku: string;
}

/** The answer for a discount code sent with a quote. `total` of the quote never includes it. */
export type CartQuoteDiscount =
  | { code: string; amount: number }
  | { error: string; code: 'discount_invalid' | 'discount_minimum' | 'rate_limited' };

export interface CartQuote {
  lines: CartQuoteLine[];
  total: number;
  missing: string[];
  /** Only when a code was sent and every line was found. */
  discount?: CartQuoteDiscount;
}

export interface OrderItemInput {
  productId: string;
  size?: string;
  color?: string;
  quantity: number;
}

export interface Customer {
  name: string;
  phone: string;
  note?: string;
  /** Needed for online payment. */
  email?: string;
}

export type DeliveryMethod = 'door' | 'locker' | 'collect';

export interface DeliveryAddress {
  line1: string;
  line2?: string;
  suburb: string;
  city: string;
  postalCode: string;
}

/** What the customer chooses. The fee is never part of it: the server reads it from delivery_options. */
export interface DeliveryInput {
  method: DeliveryMethod;
  address?: DeliveryAddress;
  locker?: string;
}

export type PaymentMethod = 'whatsapp' | 'online';

export interface PlaceOptions {
  delivery?: DeliveryInput;
  paymentMethod?: PaymentMethod;
  /** The client address (Cloudflare's cf-connecting-ip). Only used for the per-address order limit. No ip, no limit. */
  ip?: string;
  /** A discount code, already trimmed and upper-cased. Blank means none. See place_order_v4. */
  discountCode?: string;
}

export interface DeliveryOption {
  id: string;
  name: string;
  price: number;
}

export interface OrderLine {
  productId: string;
  name: string;
  price: number;
  size?: string;
  color?: string;
  quantity: number;
  subtotal: number;
  /** Missing on orders placed before the catalogue migration. */
  variantId?: string;
  sku?: string;
}

/** `pending` means the customer pays on WhatsApp. */
export type OrderStatus =
  | 'pending'
  | 'cancelled'
  | 'awaiting_payment'
  | 'paid'
  | 'packed'
  | 'shipped'
  | 'delivered'
  | 'expired'
  | 'refunded';

export interface OrderDelivery {
  method: string;
  /** Left out when there is none. */
  address?: unknown;
  locker?: string;
  fee: number;
}

export interface OrderTracking {
  courier: string | null;
  number: string | null;
  url: string | null;
}

export interface Order {
  id: string;
  ref: string;
  createdAt: string;
  status: OrderStatus;
  lines: OrderLine[];
  /** Includes `deliveryFee`. */
  total: number;
  customer: Customer;
  /** The fields below are missing from orders read by an older edge function; null when empty. */
  deliveryFee?: number;
  delivery?: OrderDelivery | null;
  paymentMethod?: 'whatsapp' | 'online' | null;
  paymentFlag?: 'amount_mismatch' | 'refund_due' | null;
  paidAt?: string | null;
  expiresAt?: string | null;
  tracking?: OrderTracking | null;
  /** The code the order was placed with, and the amount it took off goods (never delivery). `total` is already net. */
  discountCode?: string | null;
  discountAmount?: number;
}

export interface StockShortfall {
  productId: string;
  name: string;
  /** The variant that is short. '' when the product has no such dimension. */
  size: string;
  color: string;
  requested: number;
  available: number;
}

export type PlaceOrderResult =
  | { ok: true; created: boolean; order: Order }
  | { ok: false; reason: 'missing'; missing: string[] }
  | { ok: false; reason: 'stock'; short: StockShortfall[] }
  | { ok: false; reason: 'unknown_delivery' }
  /** 5 orders per address in a rolling hour. Nothing was kept: no order, stock untouched. */
  | { ok: false; reason: 'rate_limited' }
  /** The code is unknown, off, expired or used up (one reason on purpose), or an online order would total 0. Nothing was kept. */
  | { ok: false; reason: 'discount_invalid' }
  /** Goods are below the code's minimum spend. Nothing was kept. */
  | { ok: false; reason: 'discount_minimum'; minSpend: number };

export type SetStatusResult =
  | { ok: true; changed: boolean; order: Order }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'bad_transition'; from: OrderStatus; to: string; order: Order };

/** Fields of a tracking update. A missing key keeps the stored value; null or '' clears it. */
export interface TrackingInput {
  courier?: string | null;
  number?: string | null;
  url?: string | null;
}

export type SetTrackingResult =
  | { ok: true; order: Order }
  | { ok: false; reason: 'not_found' }
  /** Only packed and shipped orders take tracking. */
  | { ok: false; reason: 'bad_status'; order: Order };

export type ExtendResult =
  | { ok: true; order: Order }
  | { ok: false; reason: 'not_found' }
  /** Not pending, or no expiry set. */
  | { ok: false; reason: 'not_extendable'; order: Order };

export type SetPaymentWindowResult =
  | { ok: true; order: Order }
  | { ok: false; reason: 'not_found' }
  /** Not awaiting_payment: nothing was changed. */
  | { ok: false; reason: 'bad_status'; order: Order };

export type LookupResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'not_found' | 'rate_limited' };

/** The only order fields the public tracking page may see. See toPublicOrder in app.ts. */
export interface PublicOrder {
  id: string;
  ref: string;
  createdAt: string;
  status: OrderStatus;
  lines: { name: string; size?: string; color?: string; quantity: number; subtotal: number }[];
  deliveryFee: number;
  total: number;
  /** The method and, for a locker, its name. Never the address. */
  delivery: { method: string; locker?: string } | null;
  tracking: OrderTracking | null;
  expiresAt: string | null;
  paymentMethod: PaymentMethod | null;
  discountCode: string | null;
  discountAmount: number;
}

/** What the pay route needs about an order. `paymentUrl` is never part of `Order`. */
export interface PaymentInfo {
  id: string;
  ref: string;
  status: OrderStatus;
  total: number;
  email: string | null;
  paymentUrl: string | null;
}

export type RecordPaymentResult =
  | { ok: true; changed: boolean; outcome: 'paid' | 'paid_late' | 'refund_due' | 'already' }
  | { ok: false; reason: 'not_found' | 'amount_mismatch' };

export interface OrderStore {
  /** With `opts.delivery` the fee comes from the delivery option, never from the caller; total = lines + fee.
   *  `paymentMethod: 'online'` stores the order as awaiting_payment. A retried id returns the order unchanged. */
  place(id: string, items: OrderItemInput[], customer: Customer, opts?: PlaceOptions): Promise<PlaceOrderResult>;
  /** Newest first. */
  list(): Promise<Order[]>;
  /** null = not found. */
  get(id: string): Promise<Order | null>;
  /** null = not found. Already-cancelled returns the order unchanged and does not restore stock again. */
  cancel(id: string): Promise<Order | null>;
  /** Move an order along its lifecycle (see ORDER_TRANSITIONS in dev.ts and set_order_status in SQL).
   *  With `from`, the order must be in that status or nothing changes ('bad_transition').
   *  The requested status already holding is a no-op ({ok:true, changed:false}). */
  setStatus(id: string, status: OrderStatus, from?: OrderStatus): Promise<SetStatusResult>;
  /** Stores courier, number and url (see TrackingInput) on a packed or shipped order. */
  setTracking(id: string, tracking: TrackingInput): Promise<SetTrackingResult>;
  /** A pending order with an expiry: expires_at = greatest(expires_at, now) + 48 hours. */
  extend(id: string): Promise<ExtendResult>;
  /** An awaiting_payment order only: expires_at = now + `hours` (set_payment_window). Used for a payment link the
   *  admin sends, which has to hold its stock longer than a checkout does. Any other status is 'bad_status', unchanged. */
  setPaymentWindow(id: string, hours: number): Promise<SetPaymentWindowResult>;
  /** The id of the newest order with this 8-character reference (any case) whose phone has the same last 9
   *  digits. Every miss is the same 'not_found'. With `ip`, 10 lookups per address in a rolling hour, then
   *  'rate_limited'; no ip, no limit. */
  lookup(ref: string, phone: string, ip?: string): Promise<LookupResult>;
  /** null = not found. */
  paymentInfo(id: string): Promise<PaymentInfo | null>;
  /** Stores the provider reference and checkout URL while the order is awaiting_payment. true = stored (or
   *  already stored with the same values); false = not awaiting_payment, unknown, or other values stored. */
  attachPayment(id: string, reference: string, url: string): Promise<boolean>;
  /** A payment the provider VERIFIED: amount (cents) and currency come from the provider, never the webhook body.
   *  See record_payment in 20261030120000_payments.sql for the outcomes. */
  recordPayment(reference: string, amountCents: number, currency: string): Promise<RecordPaymentResult>;
}

export type CreateProductResult =
  | { ok: true; product: Product }
  | { ok: false; reason: 'unknown_category' };

export type UpdateProductResult =
  | { ok: true; product: Product }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'unknown_category' }
  | { ok: false; reason: 'stock_changed'; stock: number; variants: { id: string; stock: number }[] };

export interface ProductStore {
  /** Oldest first, id as the tie-break. Inactive products only with `includeInactive`. */
  list(includeInactive?: boolean): Promise<Product[]>;
  /** By id or slug (an id match wins). Inactive products are returned too; the caller checks `active`. */
  get(idOrSlug: string): Promise<Product | null>;
  create(input: NewProduct): Promise<CreateProductResult>;
  /** Merge `patch` under a row lock. Stock changes only by `variants` (per variant) or, without `variants`,
   *  when `patch.stock` is set (a new total). A stale expectedStock gives 'stock_changed' and writes nothing. */
  update(
    id: string,
    patch: Partial<ProductInput>,
    expectedStock?: number,
    variants?: VariantStockInput[],
  ): Promise<UpdateProductResult>;
  /** false = no such product. */
  remove(id: string): Promise<boolean>;
}

export type DeleteCategoryResult = { ok: true } | { ok: false; reason: 'in_use'; count: number };

export interface CategoryStore {
  /** Ordered by sort, then name. Inactive ones only with `includeInactive`. */
  list(includeInactive?: boolean): Promise<Category[]>;
  /** Insert or update by id. A missing `sort` or `active` keeps the stored value (0 and true for a new row). */
  upsert(cat: { id: string; name: string; sort?: number; active?: boolean }): Promise<Category>;
  remove(id: string): Promise<DeleteCategoryResult>;
}

/** An option as the admin sees it: inactive ones included. */
export interface DeliveryOptionAdmin extends DeliveryOption {
  sort: number;
  active: boolean;
}

/** What PUT /admin/delivery-options/:id takes; all three are required. */
export interface DeliveryOptionPatch {
  name: string;
  price: number;
  active: boolean;
}

export type UpdateDeliveryOptionResult =
  | { ok: true; option: DeliveryOptionAdmin }
  | { ok: false; reason: 'not_found' | 'last_active' };

export interface DeliveryOptionStore {
  /** Active options only, in sort order. */
  list(): Promise<DeliveryOption[]>;
  /** Every option, active or not, ordered by sort then id (list_delivery_options_admin). */
  listAll(): Promise<DeliveryOptionAdmin[]>;
  /** Sets name, price and active (update_delivery_option). The last active option cannot be turned off. */
  update(id: string, patch: DeliveryOptionPatch): Promise<UpdateDeliveryOptionResult>;
}

// --- Events and tickets (20261031120000_events.sql) ------------------------------------------------------------

export type EventStatus = 'draft' | 'published' | 'cancelled';

/** A ticket type as the public sees it. `available` is capacity minus sold, never below 0. */
export interface PublicTicketType {
  id: string;
  name: string;
  price: number;
  available: number;
  /** Active, inside its sale window and the event has not ended. */
  onSale: boolean;
}

export interface PublicEvent {
  id: string;
  slug: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string | null;
  venue: string;
  city: string;
  image: string;
  /** Active types only. */
  ticketTypes: PublicTicketType[];
}

export interface AdminTicketType extends PublicTicketType {
  eventId: string;
  capacity: number;
  sold: number;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  active: boolean;
  sort: number;
}

export interface AdminEvent extends Omit<PublicEvent, 'ticketTypes'> {
  status: EventStatus;
  createdAt: string;
  ticketTypes: AdminTicketType[];
}

/** The fields an admin edits. A missing key keeps the stored value; `endsAt: null` clears the end. */
export interface EventInput {
  title?: string;
  description?: string;
  startsAt?: string;
  endsAt?: string | null;
  venue?: string;
  city?: string;
  image?: string;
  status?: EventStatus;
  /** Only needed to change the link; a new event gets one from its title. */
  slug?: string;
}

export interface TicketTypeInput {
  /** Needed on create, ignored on update. */
  eventId?: string;
  name?: string;
  price?: number;
  capacity?: number;
  saleStartsAt?: string | null;
  saleEndsAt?: string | null;
  active?: boolean;
  sort?: number;
}

export interface TicketHolder {
  name: string;
  phone: string;
  email?: string;
}

/** The full ticket record, holder details included. The public only ever sees toPublicTicket in events_routes.ts. */
export interface Ticket {
  id: string;
  code: string;
  groupId: string;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  startsAt: string;
  venue: string;
  city: string;
  ticketTypeId: string;
  ticketTypeName: string;
  holderName: string;
  holderPhone: string;
  holderEmail: string | null;
  source: 'rsvp' | 'issued';
  checkedInAt: string | null;
  voidedAt: string | null;
  createdAt: string;
}

/** The only ticket fields the public ticket page may see. */
export interface PublicTicket {
  eventTitle: string;
  eventSlug: string;
  startsAt: string;
  venue: string;
  city: string;
  ticketTypeName: string;
  /** The first word of the holder's name. Never the full name, phone or email. */
  holderFirstName: string;
  status: 'valid' | 'used' | 'void';
  checkedInAt: string | null;
}

export type IssueResult =
  | { ok: true; created: boolean; tickets: Ticket[] }
  /** The ticket type, or for an RSVP the published event, does not exist. */
  | { ok: false; reason: 'not_found' | 'id_taken' | 'bad_quantity' | 'paid_type' | 'event_ended' | 'not_on_sale' | 'event_cancelled' | 'rate_limited' }
  | { ok: false; reason: 'sold_out'; available: number };

export type UpsertEventResult =
  | { ok: true; created: boolean; event: AdminEvent }
  | { ok: false; reason: 'slug_taken' | 'bad_dates' | 'missing_fields' };

export type UpsertTicketTypeResult =
  | { ok: true; created: boolean; ticketType: AdminTicketType }
  | { ok: false; reason: 'event_not_found' | 'missing_fields' | 'bad_dates' }
  | { ok: false; reason: 'capacity_below_sold'; sold: number };

export type DeleteEventResult = { ok: true } | { ok: false; reason: 'not_found' | 'has_tickets' };

export type CheckInResult =
  | { result: 'ok' | 'already' | 'void' | 'wrong_event'; ticket: Ticket; checkedInAt: string | null }
  | { result: 'not_found' };

export type VoidResult =
  | { ok: true; changed: boolean; ticket: Ticket }
  | { ok: false; reason: 'not_found' }
  /** A checked-in ticket cannot be voided. */
  | { ok: false; reason: 'used'; ticket: Ticket };

export interface EventStore {
  /** Published events that have not ended, soonest first; with `past`, the ended ones, newest first. */
  listPublic(past?: boolean): Promise<PublicEvent[]>;
  /** A published event, else null (draft, cancelled and unknown are the same). */
  getPublic(slug: string): Promise<PublicEvent | null>;
  /** Free tickets (1 to 4) for a published event that has not ended. `id` is the group id: a retried id returns the
   *  same tickets and takes no capacity. With `ip`, 5 RSVPs per address in a rolling hour; no ip, no limit. */
  rsvp(id: string, slug: string, ticketTypeId: string, quantity: number, holder: TicketHolder, ip?: string): Promise<IssueResult>;
  /** The full record of one ticket, else null. */
  getTicket(code: string): Promise<Ticket | null>;
  /** Every event, any status, newest start first. */
  listAdmin(): Promise<AdminEvent[]>;
  upsertEvent(id: string, input: EventInput): Promise<UpsertEventResult>;
  deleteEvent(id: string): Promise<DeleteEventResult>;
  upsertTicketType(id: string, input: TicketTypeInput): Promise<UpsertTicketTypeResult>;
  /** 'has_tickets' when sold > 0 or any ticket (even a void one) points at the type. */
  deleteTicketType(id: string): Promise<DeleteEventResult>;
  /** The owner's tickets (1 to 20) for a paid or free type; same capacity lock and idempotency. */
  issue(id: string, ticketTypeId: string, quantity: number, holder: TicketHolder): Promise<IssueResult>;
  /** null = no such event. */
  listTickets(eventId: string): Promise<Ticket[] | null>;
  /** First call wins. `at` is an offline scan time, kept only if within the past 24 hours and not in the future.
   *  With `eventId`, a ticket of another event is 'wrong_event' and nothing is written. */
  checkIn(code: string, at?: string, eventId?: string): Promise<CheckInResult>;
  /** Returns the seat once. */
  voidTicket(code: string): Promise<VoidResult>;
}

/** One customer of the owner's list: every order grouped by phone (list_customers). `spent` is paid, packed, shipped and
 *  delivered orders only; `orders` leaves out cancelled and expired. */
export interface CustomerSummary {
  phone: string;
  name: string;
  email: string | null;
  orders: number;
  spent: number;
  lastOrderAt: string;
  subscribed: boolean;
}

export interface CustomerStore {
  /** Newest last order first, then phone. Built from the orders and the mailing list, never stored. */
  list(): Promise<CustomerSummary[]>;
}

// --- Discount codes (20261031190000_discounts.sql) -------------------------------------------------------------

export type DiscountKind = 'percent' | 'fixed';

/** A code as the owner sees it. `uses` is counted by the server and cannot be set. */
export interface Discount {
  id: string;
  code: string;
  kind: DiscountKind;
  value: number;
  minSpend: number;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  active: boolean;
  createdAt: string;
}

/** What PUT /admin/discounts/:id takes (after validateDiscountInput has filled the defaults). */
export interface DiscountInput {
  code: string;
  kind: DiscountKind;
  value: number;
  minSpend: number;
  expiresAt: string | null;
  maxUses: number | null;
  active: boolean;
}

export type UpsertDiscountResult =
  | { ok: true; discount: Discount }
  | { ok: false; reason: 'code_taken' };

export type DiscountCheckResult =
  | { ok: true; code: string; amount: number }
  | { ok: false; reason: 'discount_invalid' | 'rate_limited' }
  | { ok: false; reason: 'discount_minimum'; minSpend: number };

export interface DiscountStore {
  /** Every code, newest first. */
  list(): Promise<Discount[]>;
  /** Creates or updates by id. Never touches `uses`. A code another row has is 'code_taken'. */
  upsert(id: string, input: DiscountInput): Promise<UpsertDiscountResult>;
  /** The public check (check_discount): 20 per address in a rolling hour, then 'rate_limited'; no ip, no limit. A pure
   *  read otherwise. `goods` is the lines total, without delivery. */
  check(code: string, goods: number, ip?: string): Promise<DiscountCheckResult>;
}

export interface Deps {
  products: ProductStore;
  deliveryOptions: DeliveryOptionStore;
  discounts: DiscountStore;
  customers: CustomerStore;
  categories: CategoryStore;
  orders: OrderStore;
  events: EventStore;
  community: CommunityStore;
  restock: RestockStore;
  listSends: ListSendStore;
  fits: FitStore;
  /** null when INSTAGRAM_ACCESS_TOKEN or INSTAGRAM_USER_ID is unset: the "Your fit, here" wall is then off. */
  instagram: InstagramProvider | null;
  /** Stores a fit photo in the image bucket under `path` (replacing any file there) and returns its public URL. */
  storeFitImage(path: string, file: File): Promise<string>;
  /** Removes a stored fit photo file. Throws when the removal failed. */
  removeFitImage(path: string): Promise<void>;
  /** Lets `task` finish after the response has gone (EdgeRuntime.waitUntil). It must never reject. */
  background(task: Promise<unknown>): void;
  /** null when no payment key is configured: online payment is then off. */
  payments: PaymentProvider | null;
  /** null when no email key is configured: no order emails are sent. */
  mailer: Mailer | null;
  /** The live site address without a trailing slash, for links in emails and the payment return URL. null = unset. */
  siteUrl: string | null;
  isAdmin(authHeader: string | null): Promise<'ok' | 'unauthenticated' | 'forbidden'>;
  uploadImage(file: File): Promise<string>;
}

// --- Community: gallery and mailing list (20261031130000_community.sql) -----------------------------------------

export type SubscriberSource = 'community' | 'footer' | 'event';

/** A gallery item as the public sees it. */
export interface PublicGalleryItem {
  id: string;
  image: string;
  caption: string;
  eventId: string | null;
}

export interface AdminGalleryItem extends PublicGalleryItem {
  sort: number;
  active: boolean;
  createdAt: string;
}

/** A missing key keeps the stored value; `eventId: null` clears the link. A new item needs `image`. */
export interface GalleryInput {
  image?: string;
  caption?: string;
  eventId?: string | null;
  sort?: number;
  active?: boolean;
}

export type UpsertGalleryResult =
  | { ok: true; created: boolean; item: AdminGalleryItem }
  | { ok: false; reason: 'missing_fields' | 'event_not_found' };

/** A subscriber as the owner sees them. The consent wording is kept in the table, not listed. */
export interface Subscriber {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  source: SubscriberSource;
  consentAt: string;
  unsubscribedAt: string | null;
  createdAt: string;
}

export interface SubscribeInput {
  name?: string;
  phone?: string;
  email?: string;
  source: SubscriberSource;
}

export interface CommunityStore {
  /** Active items, by sort then newest. */
  listGalleryPublic(): Promise<PublicGalleryItem[]>;
  /** Every item, hidden ones too, in the same order. */
  listGalleryAdmin(): Promise<AdminGalleryItem[]>;
  upsertGalleryItem(id: string, input: GalleryInput): Promise<UpsertGalleryResult>;
  /** false = no such item. */
  deleteGalleryItem(id: string): Promise<boolean>;
  /** Adds the person, or renews the consent of one already on the list (and clears an opt-out). `consentText` is
   *  the wording stored with the consent time. `ip` is the client address for the limit of 5 an hour; none, no limit. */
  subscribe(input: SubscribeInput, consentText: string, ip?: string): Promise<{ ok: true } | { ok: false; reason: 'rate_limited' }>;
  /** Self-service opt-out by phone, email or both: every matching subscriber gets `unsubscribedAt` set (the first time
   *  is kept) and nothing is deleted. Always `{ok:true}`, whether or not anyone matched. It shares the sign-up limit:
   *  `ip` is the client address, and 5 sign-ups and unsubscribes together an hour is the most; none, no limit. */
  unsubscribeContact(input: { phone?: string; email?: string }, ip?: string): Promise<{ ok: true } | { ok: false; reason: 'rate_limited' }>;
  /** Newest first, opted-out ones too. */
  listSubscribers(): Promise<Subscriber[]>;
  /** Opts out; a second call keeps the first time. null = no such subscriber. */
  unsubscribe(id: string): Promise<Subscriber | null>;
}

// --- Restock alerts (20261031150000_restock_alerts.sql) --------------------------------------------------------

/** A customer waiting for a size and colour to come back, as the owner sees it. Exactly one of phone and email is set.
 *  The product and variant details are current, so `stock` shows what has come back. */
export interface RestockRequest {
  id: string;
  productId: string;
  productName: string;
  productSlug: string;
  variantId: string;
  size: string;
  color: string;
  stock: number;
  phone: string | null;
  email: string | null;
  createdAt: string;
}

/** What a customer sends: the variant and exactly one contact. The product comes from the URL. */
export interface RestockInput {
  productId: string;
  variantId: string;
  phone?: string;
  email?: string;
}

export type RestockResult = { ok: true } | { ok: false; reason: 'rate_limited' | 'not_found' | 'in_stock' };

export interface RestockStore {
  /** Records the request. `{ok:true}` for a new request and for a repeat from the same contact for the same variant
   *  (one row, same answer). 'not_found' = no such active product, or the variant is another product's. 'in_stock' =
   *  the variant has stock. `ip` is the client address for the shared limit of 5 an hour (with sign-ups and
   *  unsubscribes); none, no limit. Requests older than 180 days are deleted, up to 200 per call. */
  request(input: RestockInput, ip?: string): Promise<RestockResult>;
  /** Oldest first. */
  list(): Promise<RestockRequest[]>;
  /** false = no such request. */
  remove(id: string): Promise<boolean>;
}

// --- Sending to the mailing list (20261031160000_list_sends.sql) ------------------------------------------------

/** One email to the list and how far it has got. `total` is the snapshot taken when it was created; the five states add
 *  up to it. A recipient is 'sending' while a batch is in flight, and stays so if the process dies (never re-sent). */
export interface ListSendSummary {
  id: string;
  subject: string;
  body: string;
  total: number;
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  skipped: number;
  createdAt: string;
  /** null until no recipient is pending or sending. */
  finishedAt: string | null;
}

export interface ListSendInput {
  subject: string;
  body: string;
}

/** A claimed recipient: the address is read at claim time, so an opt-out is respected up to that moment. */
export interface ListSendRecipient {
  subscriberId: string;
  email: string;
}

export interface ListSendStore {
  /** Creates the send under a client id and snapshots every subscriber with an email and no opt-out as pending
   *  (finished at once if there are none). A repeat id changes nothing: `created` false and the existing summary. */
  create(id: string, input: ListSendInput): Promise<{ created: boolean; send: ListSendSummary }>;
  /** Takes up to `limit` (default 100) pending recipients, oldest subscriber id first, marking them 'sending' with one
   *  more attempt. Anyone who has since opted out or has no email becomes 'skipped' and is not returned. Rows left
   *  'sending' are never taken again. null = no such send. */
  claimBatch(id: string, limit?: number): Promise<{ recipients: ListSendRecipient[]; summary: ListSendSummary } | null>;
  /** Settles the given recipients that are still 'sending': `ok` makes them 'sent'; otherwise back to pending, or
   *  'failed' once they have had 3 attempts. null = no such send. */
  finishBatch(id: string, subscriberIds: string[], ok: boolean): Promise<ListSendSummary | null>;
  /** Newest first, up to 50. */
  listAdmin(): Promise<ListSendSummary[]>;
}

// --- Fit photos: "Your fit, here" (20261101100000_fit_photos.sql) ------------------------------------------------

/** A photo someone tagged the shop in, as the public sees it. `postedAt` is an ISO time. */
export interface FitPhoto {
  id: string;
  image: string;
  username: string;
  permalink: string;
  postedAt: string;
}

/** A stored photo as the owner sees it. `path` is the file in the bucket; the API never sends it out. A hidden photo
 *  stays as a row (a tombstone) so the next sync does not bring it back. */
export interface AdminFitPhoto extends FitPhoto {
  path: string;
  hidden: boolean;
}

export interface FitSyncStatus {
  lastOkAt: string | null;
  /** '' when the last sync was clean, else a code: fetch_failed, image_failed or sync_failed. */
  lastError: string;
}

export type FitPhotoInput = FitPhoto & { path: string };

export interface FitStore {
  /** The wall: shown photos, newest first, at most 6. */
  listPublic(): Promise<FitPhoto[]>;
  /** Every stored row, hidden ones too, newest first. */
  listAdmin(): Promise<AdminFitPhoto[]>;
  /** Inserts or updates a photo. false = not stored (the id is hidden). */
  upsert(input: FitPhotoInput): Promise<boolean>;
  /** Deletes the row, hidden or not. false = no such row. */
  remove(id: string): Promise<boolean>;
  /** Hides a photo (a tombstone) and returns the file it had so the caller can delete it. found false = no such row. */
  hide(id: string): Promise<{ found: boolean; path: string }>;
  /** true when the caller may sync now: nothing was started in the last `minAgeSeconds`. Records the attempt. */
  claimSync(minAgeSeconds: number): Promise<boolean>;
  /** Ends a claimed sync. '' = clean (records lastOkAt), else an error code. */
  finishSync(error: string): Promise<void>;
  status(): Promise<FitSyncStatus>;
}

/** One post the shop is tagged in, as Instagram describes it. `timestamp` is Instagram's own text, for example
 *  2026-11-01T10:00:00+0000. `mediaUrl` is null when Instagram gives none (some albums and videos). */
export interface TaggedMedia {
  id: string;
  mediaType: string;
  mediaUrl: string | null;
  username: string;
  permalink: string;
  timestamp: string;
}

export interface InstagramProvider {
  /** The newest tagged posts, first page only. Throws on any failure; the message never has the token or the URL. */
  listTagged(limit: number): Promise<TaggedMedia[]>;
  /** Fetches one of Instagram's own image URLs. Throws for any other host, a non-image or a body over 5 MB. */
  download(url: string): Promise<File>;
}
