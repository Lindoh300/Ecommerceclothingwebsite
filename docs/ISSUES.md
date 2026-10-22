# Known Issues

Issues found during a review of the codebase. They are ordered by severity, most severe first.

| # | Issue | Severity |
|---|-------|----------|
| 1 | [Product data is per-browser, not shared](#1-product-data-is-per-browser-not-shared) | Critical |
| 2 | [Admin authentication is not secure](#2-admin-authentication-is-not-secure) | Critical |
| 3 | [Uploaded images can exhaust `localStorage`](#3-uploaded-images-can-exhaust-localstorage) | High |
| 4 | [Product and logo images are missing](#4-product-and-logo-images-are-missing) | Medium |
| 5 | [Stock is never decremented or enforced](#5-stock-is-never-decremented-or-enforced) | Medium |
| 6 | [No payment or order record at checkout](#6-no-payment-or-order-record-at-checkout) | Medium |
| 7 | [Supabase backend is scaffolded but unused](#7-supabase-backend-is-scaffolded-but-unused) | Low |
| 8 | [Contact details are hardcoded in several places](#8-contact-details-are-hardcoded-in-several-places) | Low |
| 9 | [Many unused dependencies and UI components](#9-many-unused-dependencies-and-ui-components) | Low |
| 10 | [Admin delete button throws an error](#10-admin-delete-button-throws-an-error) | High |

**Status:** Fixed: #8 (P1.2), #9 (P1.6), #10 (P1.0). Partly addressed: #2 (P1.1), #5 (P1.3), #6 (P1.4). Open: the rest. See [ROADMAP.md](ROADMAP.md).

---

## 1. Product data is per-browser, not shared

**Where:** [`src/app/utils/storage.ts`](../src/app/utils/storage.ts)

The catalog lives only in the visitor's `localStorage` under the key `clothing_store_products`. The first time each browser opens the site, it saves the five hardcoded `defaultProducts` there.

**Impact:**
- Products added in `/admin` exist only in the admin's own browser. Customers never see them; they only see the five sample products.
- Admin changes can be lost when browser data is cleared, in a private window, or on another device.
- Customers can change prices or products by editing `localStorage` in DevTools. Because checkout reads prices from the cart in `localStorage`, those edited prices go into the WhatsApp order message.

**Suggested fix:** Store products in a server-side database. The Supabase key-value store in [`supabase/functions/server/kv_store.tsx`](../supabase/functions/server/kv_store.tsx) is already set up (see #7). Add read and write endpoints, and have `storage.ts` call them instead of using `localStorage`.

---

## 2. Admin authentication is not secure

**Where:** [`src/app/components/Admin.tsx`](../src/app/components/Admin.tsx)

- The password is a constant in the client code: `const ADMIN_PASSWORD = "admin123"`. It ships in the JavaScript bundle sent to every visitor.
- The login page shows it in plain text: `Default password: admin123`.
- Being logged in is just `sessionStorage.admin_authenticated = 'true'`, which anyone can set in DevTools.
- The footer links to `/admin` for every visitor ([`Footer.tsx`](../src/app/components/Footer.tsx)).

**Impact:** Today the damage is limited, because admin changes only affect the admin's own browser (#1). Once products are stored on a server, though, this would let anyone change the live catalog.

**Suggested fix:** Use real server-side authentication, such as Supabase Auth. Check permissions on the server for every write. Remove the on-screen password hint and the public footer link.

**Status:** Partly addressed by P1.1; the rest is in P2.3.

---

## 3. Uploaded images can exhaust `localStorage`

**Where:** `handleImageUpload` in [`Admin.tsx`](../src/app/components/Admin.tsx), plus `addProduct` and `addToCart` in [`storage.ts`](../src/app/utils/storage.ts)

The admin panel turns uploaded images (up to 2MB each, 3 per product) into base64 data URLs and saves them inside the product records. Browsers allow only about 5MB of `localStorage` per site. On top of that, `addToCart` copies the entire product object into the cart, images included, so each image is stored again for every item in the cart.

**Impact:** After a few products, saves fail with `QuotaExceededError`. The code catches this, shows an `alert()`, and then re-throws the error. Adding to the cart can fail the same way.

**Suggested fix:** Upload images to file storage (for example Supabase Storage) and save only their URLs. Have cart items store the product `id`, size, colour and quantity rather than the whole product.

---

## 4. Product and logo images are missing

**Where:** `defaultProducts` in [`storage.ts`](../src/app/utils/storage.ts), and [`Header.tsx`](../src/app/components/Header.tsx)

The sample products point to `/images/products/tshirt1.jpg`, `jersey1.jpg`, `shorts1.jpg`, `pants1.jpg` and `cap1.jpg`. The header points to `/images/logo.jpg`. None of these files exist. `public/images/` contains only `hero-bg.jpg`, `hero-placeholder.svg` and `logo-placeholder.svg`.

**Impact:** Every sample product shows the grey "No Image" placeholder, and the header always shows the placeholder logo. The WhatsApp checkout message also includes links to these images, which return 404.

**Suggested fix:** Add the real images under `public/images/`, or point the sample products to images that exist.

---

## 5. Stock is never decremented or enforced

**Where:** [`ProductDetail.tsx`](../src/app/components/ProductDetail.tsx), [`Cart.tsx`](../src/app/components/Cart.tsx), [`storage.ts`](../src/app/utils/storage.ts)

Stock is displayed, and the quantity picker on the product page won't go above it. But:
- Checking out never reduces `stock`.
- The cap applies to each "Add to cart" click separately. Adding the same item repeatedly puts more than the available stock in the cart.
- The quantity buttons on the cart page have no upper limit at all.

**Impact:** The shop can receive orders for stock it doesn't have, and the "in stock" numbers are never accurate.

**Suggested fix:** Check stock against the cart's total quantity in `addToCart` and `updateCartItem`. Once orders are stored on a server (#6), reduce stock there when an order is placed.

**Status:** Partly addressed by P1.3; the rest is in P3.2.

---

## 6. No payment or order record at checkout

**Where:** `handleWhatsAppCheckout` in [`Cart.tsx`](../src/app/components/Cart.tsx)

Checkout opens a WhatsApp chat with a pre-written order message and then immediately clears the cart.

**Impact:**
- No order is saved anywhere, so if the customer closes WhatsApp without sending, the order is lost and the cart is already empty.
- There is no online payment. Every payment has to be arranged by hand.
- Prices in the message come from the customer's browser, so they can be edited (see #1).

**Suggested fix:** At a minimum, keep the cart until the customer confirms they sent the message. For a proper store, save orders on the server and add a South African payment gateway such as PayFast, Yoco or Paystack.

**Status:** Partly addressed by P1.4; the rest is in P3.1 and P3.3.

---

## 7. Supabase backend is scaffolded but unused

**Where:** [`supabase/functions/server/`](../supabase/functions/server/), [`utils/supabase/info.tsx`](../utils/supabase/info.tsx)

A Supabase Edge Function (Deno + Hono) and a key-value store were generated, but the only endpoint is `/make-server-fbb8f0e1/health`. Nothing in `src/` calls the backend.

**Impact:** This code isn't hurting anything, but it is the natural place to fix #1, #2, #3 and #6.

**Note:** The `publicAnonKey` in `info.tsx` is a public, client-side key, so committing it is expected. Once tables hold real data, make sure Row Level Security is enabled on them.

---

## 8. Contact details are hardcoded in several places

**Where:** [`Cart.tsx`](../src/app/components/Cart.tsx) (`whatsappNumber = "27678684428"`), [`CustomerService.tsx`](../src/app/components/CustomerService.tsx) (phone, WhatsApp, email, social links), and likely [`Footer.tsx`](../src/app/components/Footer.tsx) and `About.tsx`

**Impact:** Changing the phone number or email means editing several files, and it's easy to miss one.

**Suggested fix:** Move shop details into one config module, such as `src/app/config/shop.ts`, and import it wherever they're needed.

**Status:** Fixed in P1.2.

---

## 9. Many unused dependencies and UI components

**Where:** [`package.json`](../package.json), [`src/app/components/ui/`](../src/app/components/ui/)

The Figma Make template installs many packages that the app code never imports, including `@mui/material`, `@mui/icons-material`, `@emotion/*`, `recharts`, `react-dnd`, `motion`, `react-slick`, `react-responsive-masonry`, `canvas-confetti` and `react-hook-form`. Some of these are used only by the unused shadcn/ui components. Of the roughly 45 shadcn/ui components, the pages use only `button`, `input`, `label`, `textarea`, `select` and `sonner`.

**Impact:** Slower installs and a larger, noisier codebase. Unused imports are mostly removed from the production bundle at build time, so users barely notice.

**Suggested fix:** Remove the unused packages and `ui/` components. Run `npm run build` afterwards to confirm nothing breaks.

**Status:** Fixed in P1.6.

---

## 10. Admin delete button throws an error

**Where:** [`Admin.tsx`](../src/app/components/Admin.tsx) (the delete button, about line 412, and the `deleteProduct` import on line 2)

The delete button calls `handleDelete(product.id, product.name)`, but `handleDelete` is never defined in the component. `deleteProduct` is imported from [`storage.ts`](../src/app/utils/storage.ts) but never used. This was already in the original code.

**Impact:** Clicking delete throws a `ReferenceError` and the product is not removed. Products cannot be deleted from the admin panel.

**Suggested fix:** Add a `handleDelete(id, name)` function to `Admin.tsx`. It should ask for confirmation with `window.confirm`, call `deleteProduct(id)`, refresh the product list, and show a `toast` from `sonner`.

**Status:** Fixed in P1.0.
