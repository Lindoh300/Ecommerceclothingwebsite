# Roadmap

This roadmap lists the planned work for the 4Nguru storefront, grouped into phases. Each item names the known problem it addresses, with a link to [ISSUES.md](ISSUES.md). Phases are ordered by dependency, so a later phase assumes the earlier ones are done. When an item lands, update its status here and add a line to [changelog.md](changelog.md).

## Legend

**Status:** ✅ done, 🚧 in progress, ⬜ planned

**Size:** S (under a day), M (a few days), L (a week or more)

---

## Phase 0: Foundations (✅)

| ID | Item | Issue | Size | Depends on | Status |
|----|------|-------|------|------------|--------|
| P0.1 | Project docs (AGENTS.md, roadmap, changelog) | | S | | ✅ |
| P0.2 | Prism reskin of all pages | [#4](ISSUES.md#4-product-and-logo-images-are-missing) (partial) | L | P0.1 | ✅ |

### P0.1 Project docs

**What to do:** Write `AGENTS.md` for coding agents and contributors, `docs/ROADMAP.md`, and `docs/changelog.md` in Keep a Changelog style.

**Files:** `AGENTS.md`, `docs/ROADMAP.md`, `docs/changelog.md`

**Acceptance criteria:**
- [x] `AGENTS.md` covers the stack, commands, directory map, data flow, design rules and guardrails.
- [x] `docs/changelog.md` has an `[Unreleased]` section and a `[0.0.1]` entry.
- [x] `docs/ROADMAP.md` has a legend, every phase, and an issue coverage table.
- [x] Every link to `ISSUES.md` resolves to a heading in that file.

### P0.2 Prism reskin of all pages

**What to do:** Apply the Prism design system to every page: the header, footer, home, category, product detail, cart, about, customer service, admin and not-found pages. Missing product images show `GooArt` through `ProductImage`.

**Files:** `src/styles/index.css`, `src/styles/theme.css`, `src/styles/prism.css`, `src/app/components/prism/`, and all page components in `src/app/components/`

**Acceptance criteria:**
- [x] `index.css` imports `prism.css`, and the Prism tokens are defined in `theme.css`.
- [x] No page uses a colour outside the theme tokens.
- [x] Missing product images render `GooArt`, not the grey "No Image" box.
- [x] Headings use the uppercase display style.
- [x] Animations are off when `prefers-reduced-motion` is set.
- [x] `npm run build` passes, and every page renders in `npm run dev` at desktop and phone widths.

---

## Phase 1: Quick wins, no backend (⬜)

| ID | Item | Issue | Size | Depends on | Status |
|----|------|-------|------|------------|--------|
| P1.0 | Fix the admin delete button | [#10](ISSUES.md#10-admin-delete-button-throws-an-error) | S | | ⬜ |
| P1.1 | Remove the on-screen admin password hint and the public footer `/admin` link | [#2](ISSUES.md#2-admin-authentication-is-not-secure) (partial) | S | | ⬜ |
| P1.2 | Central shop config module `src/app/config/shop.ts` for the WhatsApp number, phone, email and socials | [#8](ISSUES.md#8-contact-details-are-hardcoded-in-several-places) | S | | ⬜ |
| P1.3 | Client-side stock enforcement in `addToCart` and `updateCartItem` against total cart quantity; cart +/- capped at stock | [#5](ISSUES.md#5-stock-is-never-decremented-or-enforced) (partial) | S | | ⬜ |
| P1.4 | Keep the cart after WhatsApp checkout until the customer confirms they sent the message | [#6](ISSUES.md#6-no-payment-or-order-record-at-checkout) (partial) | S | | ⬜ |
| P1.5 | Real product and logo images, or point the sample products at existing images | [#4](ISSUES.md#4-product-and-logo-images-are-missing) | M | Owner supplies photos | ⬜ |
| P1.6 | Remove unused dependencies and shadcn/ui components, verified by build | [#9](ISSUES.md#9-many-unused-dependencies-and-ui-components) | S | | ⬜ |

### P1.0 Fix the admin delete button

**What to do:** Define `handleDelete(id, name)` in `Admin.tsx`. It asks for confirmation with `window.confirm`, calls `deleteProduct(id)` from `storage.ts`, refreshes the product list, and shows a `toast` from `sonner`.

**Files:** `src/app/components/Admin.tsx`

**Acceptance criteria:**
- [ ] Clicking delete in `/admin` no longer throws a `ReferenceError`.
- [ ] Confirming the prompt removes the product from the list and from `localStorage`.
- [ ] Cancelling the prompt leaves the product in place.
- [ ] A toast confirms the deletion.

### P1.1 Remove the admin password hint and public admin link

**What to do:** Delete the line that shows the default password on the admin login page. Remove the `/admin` link from the footer. The admin page stays reachable by typing its URL.

**Files:** `src/app/components/Admin.tsx`, `src/app/components/Footer.tsx`

**Acceptance criteria:**
- [ ] The login page no longer shows any password text.
- [ ] The footer has no link to `/admin`.
- [ ] `/admin` still loads when typed directly.

### P1.2 Central shop config

**What to do:** Create `src/app/config/shop.ts` that exports the WhatsApp number, phone, email and social links. Replace the hardcoded values in the cart, customer service, footer and about pages with imports from it.

**Files:** `src/app/config/shop.ts` (new), `Cart.tsx`, `CustomerService.tsx`, `Footer.tsx`, `About.tsx`

**Acceptance criteria:**
- [ ] `shop.ts` is the only place a contact number, email or social URL is written.
- [ ] Changing the WhatsApp number in `shop.ts` changes the checkout link.
- [ ] Each page shows the same details as before.

### P1.3 Stock enforcement in the cart

**What to do:** In `addToCart`, reject a quantity that would take the cart total for that product above its `stock`. Do the same in `updateCartItem`. Cap the cart +/- buttons at stock, and show a toast when a limit is hit.

**Files:** `src/app/utils/storage.ts`, `src/app/components/ProductDetail.tsx`, `src/app/components/Cart.tsx`

**Acceptance criteria:**
- [ ] Adding the same product repeatedly stops at its stock level.
- [ ] The cart +/- buttons cannot go above stock.
- [ ] The UI shows a toast when a limit blocks an action.

### P1.4 Keep the cart until the customer confirms

**What to do:** Stop clearing the cart in `handleWhatsAppCheckout`. Ask the customer to confirm they sent the order, and clear the cart only after that.

**Files:** `src/app/components/Cart.tsx`

**Acceptance criteria:**
- [ ] Opening WhatsApp from the cart does not empty the cart.
- [ ] The cart is cleared only after the customer confirms.
- [ ] Closing WhatsApp without sending leaves the cart intact.

### P1.5 Real product and logo images

**What to do:** Add the owner's photos and logo under `public/images/`. Alternatively, point the sample products at images that already exist. Requires photos from the owner.

**Files:** `public/images/`, `src/app/utils/storage.ts` (sample image paths), `src/app/components/Header.tsx` (logo path)

**Acceptance criteria:**
- [ ] Every sample product image path resolves (no 404 in the browser console).
- [ ] The header shows the real logo.
- [ ] WhatsApp checkout image links return 200.

### P1.6 Remove unused dependencies

**What to do:** Remove packages the app does not import, such as `@mui/*`, `@emotion/*`, `recharts`, `react-dnd`, `motion`, `react-slick`, `react-responsive-masonry`, `canvas-confetti` and `react-hook-form`. Delete the shadcn/ui components in `ui/` that nothing imports. Keep `button`, `input`, `label`, `textarea`, `select` and `sonner`.

**Files:** `package.json`, `src/app/components/ui/`

**Acceptance criteria:**
- [ ] `npm run build` passes after the removals.
- [ ] Each removed package is not imported anywhere in `src/`.
- [ ] Every remaining `ui/` file is imported by something.

---

## Phase 2: Supabase backend (⬜)

| ID | Item | Issue | Size | Depends on | Status |
|----|------|-------|------|------------|--------|
| P2.1 | Wire up the edge function: products CRUD endpoints on the KV store, and a typed client in `src` | [#7](ISSUES.md#7-supabase-backend-is-scaffolded-but-unused) | M | Phase 1 | ⬜ |
| P2.2 | `storage.ts` reads and writes products through the API; `localStorage` is used only for the cart | [#1](ISSUES.md#1-product-data-is-per-browser-not-shared) | M | P2.1 | ⬜ |
| P2.3 | Supabase Auth for admin, with server-side checks on every write; enable Row Level Security | [#2](ISSUES.md#2-admin-authentication-is-not-secure) | L | P2.1 | ⬜ |
| P2.4 | Product images in Supabase Storage (URLs saved); cart stores product id, size, colour and quantity; prices resolved from the server | [#3](ISSUES.md#3-uploaded-images-can-exhaust-localstorage), [#1](ISSUES.md#1-product-data-is-per-browser-not-shared) (price tampering) | L | P2.2, P2.3 | ⬜ |

### P2.1 Edge function products API

**What to do:** Add product endpoints to `supabase/functions/server/index.tsx` (list, get, create, update, delete), backed by the KV store in `kv_store.tsx`. Write a small typed client in `src/` that calls them.

**Files:** `supabase/functions/server/index.tsx`, `supabase/functions/server/kv_store.tsx`, a new client module under `src/app/`

**Acceptance criteria:**
- [ ] Each endpoint returns the expected status and body for valid input.
- [ ] Invalid input returns a 4xx response.
- [ ] The client module compiles under `npm run build`.

### P2.2 Products through the API

**What to do:** Change `storage.ts` so product reads and writes call the P2.1 client. Keep `localStorage` for the cart only. Seed the sample products on the server, not in the browser.

**Files:** `src/app/utils/storage.ts`, the pages that read products

**Acceptance criteria:**
- [ ] A product added in `/admin` appears for a customer in another browser.
- [ ] Clearing browser storage does not remove products.
- [ ] `clothing_store_products` is no longer read or written.

### P2.3 Admin auth and RLS

**What to do:** Replace the client-side password with Supabase Auth sign-in for admins. Check the admin role on the server for every write endpoint. Enable Row Level Security on every table that holds real data.

**Files:** `src/app/components/Admin.tsx`, `supabase/functions/server/index.tsx`, Supabase project settings

**Acceptance criteria:**
- [ ] A write request without a valid admin session is rejected.
- [ ] `sessionStorage.admin_authenticated` is no longer used.
- [ ] RLS is enabled, and anonymous users cannot write to any table.

### P2.4 Images in Storage and server-side prices

**What to do:** Upload product images to Supabase Storage and save only their URLs. Change cart items to store product id, size, colour and quantity. Resolve names, prices and stock from the server at checkout.

**Files:** `src/app/components/Admin.tsx`, `src/app/utils/storage.ts`, `src/app/components/Cart.tsx`, the server functions

**Acceptance criteria:**
- [ ] A product record holds URLs, not base64 data.
- [ ] A cart item in `localStorage` holds no product price or image data.
- [ ] Editing a price in DevTools does not change the price on the order or WhatsApp message.

---

## Phase 3: Orders and payments (⬜)

| ID | Item | Issue | Size | Depends on | Status |
|----|------|-------|------|------------|--------|
| P3.1 | Server-side order records created at checkout | [#6](ISSUES.md#6-no-payment-or-order-record-at-checkout) | M | P2.2 | ⬜ |
| P3.2 | Decrement stock on the server when an order is placed | [#5](ISSUES.md#5-stock-is-never-decremented-or-enforced) | S | P3.1 | ⬜ |
| P3.3 | South African payment gateway (PayFast, Yoco or Paystack); WhatsApp kept as an option | [#6](ISSUES.md#6-no-payment-or-order-record-at-checkout) | L | P3.1 | ⬜ |

### P3.1 Order records

**What to do:** Create an order record on the server when the customer checks out. Include the items, server-side prices and customer details. Keep the WhatsApp message as a copy.

**Files:** `supabase/functions/server/index.tsx`, `src/app/components/Cart.tsx`

**Acceptance criteria:**
- [ ] Every checkout creates exactly one order record.
- [ ] The record holds server-side prices.
- [ ] An order is kept even if the customer never sends the WhatsApp message.

### P3.2 Server-side stock decrement

**What to do:** When an order is placed, reduce each product's `stock` on the server in the same transaction as the order record. Reject the order if stock is insufficient.

**Files:** `supabase/functions/server/index.tsx`

**Acceptance criteria:**
- [ ] Stock drops by the ordered quantity after an order.
- [ ] An order for more than the available stock is rejected.
- [ ] Two simultaneous orders cannot both take the last unit.

### P3.3 Payment gateway

**What to do:** Choose PayFast, Yoco or Paystack, then integrate its hosted checkout. Verify payment notifications on the server before marking an order paid. Keep WhatsApp as an option for customers who prefer it.

**Files:** `supabase/functions/server/index.tsx`, `src/app/components/Cart.tsx`

**Acceptance criteria:**
- [ ] A test payment in the gateway's sandbox marks the order paid.
- [ ] The order status is set only from a verified server notification.
- [ ] The WhatsApp option still works.

---

## Issue coverage

Every known issue in [ISSUES.md](ISSUES.md) appears in at least one roadmap item.

| Issue | Roadmap items |
|-------|---------------|
| [#1](ISSUES.md#1-product-data-is-per-browser-not-shared) Product data is per-browser, not shared | P2.2, P2.4 |
| [#2](ISSUES.md#2-admin-authentication-is-not-secure) Admin authentication is not secure | P1.1, P2.3 |
| [#3](ISSUES.md#3-uploaded-images-can-exhaust-localstorage) Uploaded images can exhaust `localStorage` | P2.4 |
| [#4](ISSUES.md#4-product-and-logo-images-are-missing) Product and logo images are missing | P0.2, P1.5 |
| [#5](ISSUES.md#5-stock-is-never-decremented-or-enforced) Stock is never decremented or enforced | P1.3, P3.2 |
| [#6](ISSUES.md#6-no-payment-or-order-record-at-checkout) No payment or order record at checkout | P1.4, P3.1, P3.3 |
| [#7](ISSUES.md#7-supabase-backend-is-scaffolded-but-unused) Supabase backend is scaffolded but unused | P2.1 |
| [#8](ISSUES.md#8-contact-details-are-hardcoded-in-several-places) Contact details are hardcoded in several places | P1.2 |
| [#9](ISSUES.md#9-many-unused-dependencies-and-ui-components) Many unused dependencies and UI components | P1.6 |
| [#10](ISSUES.md#10-admin-delete-button-throws-an-error) Admin delete button throws an error | P1.0 |
