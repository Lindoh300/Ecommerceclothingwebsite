# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Security

- Upgraded React Router to 7.18.5 and Vite to 6.4.5, which clears the high audit findings, including an unauthenticated code execution advisory on React Router below 7.14.2.
- Security headers on every page through `vercel.json`: `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`.

### Added

- Placeholder favicon at `public/favicon.svg`, to be replaced with the real logo.
- Privacy page has a new draft section, "Photos you tag us in", which the owner needs to confirm.
- Added a warm dark mode with a toggle in the header. The choice is remembered.
- Home hero now leads with the slogan "For the culture." The search box and the moving strip are gone. Search stays on the shop page.
- Shop filters are now dropdowns on one row.
- Community page: added "Your fit, here" and removed the past events list. Past events stay on the events page.
- Added a "Staff sign in" link in the footer.
- Renamed the shop to 4Nguru The Brand.
- Admin Delivery: the owner edits each delivery option's name, price and on/off in the admin. Options can't be added or removed, and the last active option can't be turned off. New routes `GET /admin/delivery-options` and `PUT /admin/delivery-options/:id`, and migration `20261031170000_delivery_admin.sql`.
- Admin Customers: a read-only list of customers grouped by phone number, built from orders (name, contact, order count, amount spent, last order, and whether they are on the list). No new table. New route `GET /admin/customers` and migration `20261031180000_customers.sql`.
- Admin Discounts and discount codes at checkout: the owner creates percent or fixed codes with an optional minimum spend, expiry and use limit, and can turn them off. Customers enter a code at checkout, and the server works out the discount, taken off goods and never delivery. One code per order. A cancelled or expired order gives its use back. New routes `GET /admin/discounts` and `PUT /admin/discounts/:id`, optional `discountCode` on `POST /cart/quote` and `POST /orders`, and migration `20261031190000_discounts.sql`. The admin New order screen has no code field yet.
- Tests: a Vitest frontend test suite, run with `npm test` (and `npm run test:watch`). Tests sit next to the code in `src/`.
- Restock alerts: a customer can leave a phone number or email on a sold-out size or colour. The owner sees who is waiting in the admin Community section, messages them from WhatsApp or their mail app, and removes the request. Nothing is sent automatically, and unsubscribing also removes the person's requests.
- Sending to the list: the owner can write a plain-text email, send a test, and send it to everyone on the list with an email address, in batches. It stays off until the Resend keys and `SITE_URL` are set. Every email carries an unsubscribe line, and anyone who opts out during a send is skipped.
- Admin Orders: "Message on WhatsApp" opens the owner's WhatsApp with an update for the order's status, including tracking details once shipped.
- Admin Dashboard: a "Last 30 days" block with sales, paid orders, items sold, average order and the top five products. It uses order data only, with no visitor tracking.
- Self-service unsubscribe at `/unsubscribe`, by phone or email, linked from the footer and Privacy. The answer is the same whether or not the contact is on the list, and it shares the sign-up limit of 5 an hour per connection. New route `POST /subscribers/unsubscribe` and migration `20261031140000_unsubscribe.sql` (`unsubscribe_contact`).
- Demo data in the live database so the site looks populated: 21 extra products, photos for the five existing products, five events and eight gallery items, with 43 Unsplash photos in `product-images/demo/`. No orders, tickets or subscribers. All of it is sample content and must come out before real trading: see `docs/demo-data/README.md` and `remove.sql`. Backup: `docs/backups/demo-20261031-155940-*`.
- `gallery` theme, inspired by cosmos.so, the default look: Schibsted Grotesk, pill controls, soft 4:5 product tiles, and a home page led by a headline and search with categories as a large list. `VITE_THEME=plain` gives the plain look instead.
- Content from the old test site: About story and values, a nationwide delivery line and 3-5 working day estimate, 30-day returns with conditions, S to XL size measurements, support hours and the home tagline. Dates, customer numbers, eco claims and the old R100/R150 delivery fees stay out. The owner still has to confirm these details.
- Product search: `/shop?q=` filters by name, description, category and colour in any theme. The search box shows only in the `gallery` theme. In that theme, the shop filters collapse behind a Filters button on phones.
- Admin split into sections (Dashboard, Orders, New order, Products, Categories; the section is kept in `?section=`). Orders show as cards on phones, with a print-friendly Packing list of paid orders. New order lets the owner enter an order for a customer (any size, no per-connection limit), then copy its link or send it on WhatsApp; "Send payment link" holds the stock for 48 hours. New API route `POST /admin/orders` and migration `20261031110000_payment_links.sql` (`set_payment_window`).
- Delivery at checkout: door (R85), locker (R55) or collect (R0), placeholder rates set in the database. The server adds the fee to the order total. Orders are booked with the courier by hand.
- Admin Orders: "Mark paid" for WhatsApp orders, the delivery method with its address or locker, the expiry time of unpaid orders, and notes for a refund due or an amount mismatch.
- Online payment through Paystack, built but switched off: there is no key yet, and starting a payment returns a clear "not available" error. WhatsApp orders are unaffected. Not tested against Paystack (P3.3).
- Order limits: 5 orders per connection per hour and 10 items per order, with clear messages at checkout (P3.5).
- Link previews: the storefront now runs in React Router framework mode with server rendering on Vercel. A pasted product link shows the product's name, price and image in WhatsApp and Instagram (title, description, Open Graph tags, ZAR price and canonical slug URL in the server HTML). `/product/nope` returns 404. Home and category pages have their own titles. The site stays `noindex`. `public/images/og-default.png` is a placeholder fallback image.
- Admin: saving a stock change after an order came in now warns "Stock changed", refreshes the number and keeps the order's deduction (P3.4).
- Orders: checkout now saves the order on the server first (name, phone, optional note), then sends it on WhatsApp with its order reference. Stock is taken off when the order is placed, and an order for more than the stock is refused. Addresses [#5](ISSUES.md#5-stock-is-never-decremented-or-enforced) and [#6](ISSUES.md#6-no-payment-or-order-record-at-checkout).
- Admin Orders list with Cancel, which returns the order's stock.
- Shop page at `/shop`, with filters for category, size, colour and in stock, and sorting by newest or price.
- Redesigned home and product pages, with "Ask on WhatsApp" on the home, shop and product pages.
- Checkout has its own page at `/checkout`. Pay online is offered there only when online payment is switched on.
- Order status page at `/order/:id`, with a five-step progress line (placed, paid, packed, shipped, delivered) and "Pay now" for an order awaiting payment.
- Track an order at `/track` with the order reference and phone number. Limited to 10 lookups per connection per hour.
- Order emails when an order is received, paid and shipped. Plain text, and off until `RESEND_API_KEY` and `EMAIL_FROM` are set.
- Admin orders: move an order to packed, shipped or delivered, add courier tracking, and use "Extend 48h" on a pending order. Refund an order that was cancelled or expired with a refund due. Refunds do not return stock.
- Legal and help pages at `/terms`, `/privacy`, `/returns`, `/delivery` and `/size-guide`. They are drafts: each shows a draft notice, and "To be confirmed" where a fact is not yet known.
- Events at `/events` and `/event/:slug`. Free ticket types take an RSVP. Paid tickets say "Get tickets on WhatsApp", and the owner issues them in the admin.
- QR tickets at `/ticket/:code`, from an RSVP or issued by the owner.
- Door check-in in the admin Door section, with a scanner. The door list stays on the phone, so check-in works with poor signal.
- Community page at `/community`, with the gallery, past events and a mailing list sign-up with a consent tick box. The admin Community section manages gallery items and subscribers.
- Admin sections for Events, Door and Community.
- Admin dashboard: sales today and this week, orders to pack, unpaid orders expiring within 12 hours, refunds due, and low stock (3 units or fewer).
- Admin tabs scroll sideways on a phone, and the current tab stays in view.

- `AGENTS.md`, `docs/ROADMAP.md` and this changelog.
- Prism design system: fonts, colour and layout tokens in `src/styles/theme.css`, utility classes in `src/styles/prism.css`, and the `GooArt`, `Ticker` and `ProductImage` components in `src/app/components/prism/`.
- `.gitignore` (node_modules, dist, env files, logs, editor files).
- `package-lock.json` is now tracked.
- `src/app/config/shop.ts`: single source for the WhatsApp number, phone, email and social links. Addresses [#8](ISSUES.md#8-contact-details-are-hardcoded-in-several-places).
- Cart stock limits: `addToCart` and `updateCartItem` refuse to exceed the stock of a size and colour, and the cart "+" button disables at the limit. Partly addresses [#5](ISSUES.md#5-stock-is-never-decremented-or-enforced).
- "Did you send your order?" confirmation at checkout. The cart is kept until the customer confirms. Partly addresses [#6](ISSUES.md#6-no-payment-or-order-record-at-checkout).
- Products API on the Supabase edge function `make-server-fbb8f0e1`: list, get, create, update and delete routes, plus `POST /cart/quote` and `POST /images`. Logic is in `supabase/functions/server/app.ts`. Addresses [#7](ISSUES.md#7-supabase-backend-is-scaffolded-but-unused).
- Admin sign-in with Supabase Auth (email and password). The server checks `app_metadata.role` on every write. Addresses [#2](ISSUES.md#2-admin-authentication-is-not-secure).
- Product images stored in Supabase Storage (`product-images` bucket), with uploads limited to 2 MB jpeg, png, webp or gif. Addresses [#3](ISSUES.md#3-uploaded-images-can-exhaust-localstorage).
- Server-priced cart: the cart total and WhatsApp message come from `/cart/quote`, which reports missing product ids. Addresses [#1](ISSUES.md#1-product-data-is-per-browser-not-shared) (price tampering).
- Local dev server (`deno task dev` on :8787, in memory) and 13 Deno tests (`deno task test`).
- Supabase config and the initial migration (`supabase/config.toml`, `supabase/migrations/20261021000000_init.sql`), with Row Level Security and sign-ups disabled.
- `.env.example` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_API_BASE`.

- The "Your fit, here" wall now fills itself from photos tagged on Instagram, newest first, six at most. It stays on placeholders until Instagram is connected. The owner can hide a photo from the admin.
- The admin New order screen has a discount code field. Apply a code to see the discount before the order is created.

### Changed

- Privacy cut to a short plain notice, without legal references. Returns no longer quotes consumer law; it says its conditions do not limit any rights under South African law.
- Plain, temporary look until a brand direction is chosen: black on white, one font (Cabin), sentence-case headings, small button corners and a simple layout based on `docs/prototype`. The header shows the 4Nguru letters, with Shop, Events, Community and Cart in the nav. Category links are on `/shop` and in the footer, and About is in the footer. The mobile menu shows below `md`. Home is hero text, New in (8 products) and shop by category as plain text tiles, with no ticker. Content width is 1360px.
- New WhatsApp orders are cancelled after 48 hours unless marked paid, and their stock returns. Orders placed before this change are not affected.
- Stock is now tracked per size and colour. The shop disables options that are out, and the admin edits stock in a grid. The live data was split evenly and needs real counts.
- Categories are managed in the admin instead of being hard-coded.
- All visual styling comes from theme tokens. Set `VITE_THEME` to apply a theme in `src/styles/themes/`.
- Pages now load on demand, and supabase-js loads only for admin, so first-load JavaScript drops from 559 KB to 287 KB (92 KB compressed).
- Storefront reskinned to the Prism editorial style across all pages.
- Missing product images now show generative art instead of a grey "No Image" box. This partly addresses [#4](ISSUES.md#4-product-and-logo-images-are-missing).
- Header desktop nav collapses to a hamburger menu below 1024px (`lg`).
- Footer copyright year is now the current year, computed at runtime (it previously showed 2008).
- Accessibility labels added to icon-only buttons and links (cart, menu, social, remove, edit and delete).
- Header keeps the original multicolour 4Nguru logo.
- Products load from the API through a shared cache (`src/app/hooks/useProducts.ts`), not `localStorage`. The server seeds the sample products once. Addresses [#1](ISSUES.md#1-product-data-is-per-browser-not-shared).
- The cart stores product id, size, colour and quantity only, under `clothing_store_cart_v2`. Data under the old `clothing_store_cart` key is migrated.
- Admin login uses Supabase Auth, and photos upload to Storage. Addresses [#2](ISSUES.md#2-admin-authentication-is-not-secure) and [#3](ISSUES.md#3-uploaded-images-can-exhaust-localstorage).
- Without a `.env` file the shop shows "API not configured".
- Checkout moved from the cart page to `/checkout`. The cart links to it.
- About and Customer Service cut back to facts that can be confirmed. Unconfirmed claims are removed: since 2014, thousands of customers, eco packaging, 30-day returns, delivery fees and business hours.
- The storefront now follows the prototype's layout in the gallery theme: a split home hero with a new-in tile, a moving highlights strip, the next event, category tiles, how-to-order steps and a sign-up with a photo collage; a featured event with a countdown, upcoming posters and past nights on Events; a photo mosaic and event rows on Community; stacked filters with counts on the shop; a breadcrumb, delivery and size notes, related products and a phone buy bar on the product page; and a two-column checkout.

### Removed

- Terms page and `/terms`, removed for now because the owner may not be sure of the wording. The consumer-rights section on Returns went with it.
- Prism art, ticker and theme: `GooArt`, `GooFilters` and `Ticker`, the `components/prism/` folder (now `common/`, with `LoadState` and `ProductImage` only), `src/styles/prism.css` (now `base.css`), `src/styles/themes/` and `afterdark.css`, and the Prism tokens such as `--art-1` to `--art-6`, `--g1` to `--g6`, `--panel`, `--panel-fg` and `--font-script`. `--prism` is now `--brand`. The `.hand`, `.ticker*` and `.goo*` classes are gone.
- Figma leftovers: `src/app/components/figma/`, `default_shadcn_theme.css`, `guidelines/`, `utils/supabase/info.tsx`, `supabase/functions/server/kv_store.tsx` (the `kv_store_fbb8f0e1` database table stays), `template/prism-template.html`, the Figma asset plugin in `vite.config.ts`, `@vitejs/plugin-react`, and `public/images/hero-placeholder.svg` and `logo-placeholder.svg`.
- `public/images/hero-bg.jpg`, an HTML error page saved with a `.jpg` name.
- Default admin password hint from the admin login page, and the public footer link to `/admin`. Partly addresses [#2](ISSUES.md#2-admin-authentication-is-not-secure).
- 44 unused npm dependencies and 41 unused shadcn/ui components. Built CSS dropped from about 102 kB to about 46 kB. Addresses [#9](ISSUES.md#9-many-unused-dependencies-and-ui-components).
- Client-side admin password and the `sessionStorage` admin flag. Addresses [#2](ISSUES.md#2-admin-authentication-is-not-secure).
- Product catalogue in `localStorage` (`clothing_store_products`). Addresses [#1](ISSUES.md#1-product-data-is-per-browser-not-shared).
- Base64 image data in product records. Addresses [#3](ISSUES.md#3-uploaded-images-can-exhaust-localstorage).

### Fixed

- Unknown URLs now answer with a real 404 and still show the Not found page.
- If the admin code fails to load, the admin shows a message and a Reload button instead of staying on "Loading".
- Impossible event dates such as 30 February are refused.
- A negative or fractional cart quantity is refused.
- Checkout hides Pay online while the delivery options have failed to load, and clears that notice when the list arrives late.
- Toasts follow the site's light or dark mode. `next-themes` is removed.
- The header cart link's accessible name includes the item count.
- A corrupt stored cart line no longer breaks the cart.
- `/category/constructor` has a normal page title.
- Link previews no longer split an emoji in a description, and keep the fallback description.
- Phone numbers in the CSV export no longer get a stray apostrophe, and a formula after leading spaces is guarded.
- A South African mobile typed without its leading 0 gets a working WhatsApp link.

- Saving a product in the admin no longer wipes out stock taken by an order placed while the form was open. If the admin changed the stock and it moved meanwhile, the save is refused with the current stock. Roadmap P3.4.

- The live API blocked every browser request: the CORS preflight did not allow the `apikey` header the frontend sends. Products, admin and orders now load in the browser.

- Admin sign-in works live against Supabase project `siyupxcmfbjhpbhlpxsg` with the owner's admin user. Closes [#2](ISSUES.md#2-admin-authentication-is-not-secure).

- Admin delete button now confirms, deletes the product and shows a toast, instead of throwing a `ReferenceError`. Fixes [#10](ISSUES.md#10-admin-delete-button-throws-an-error).

## [0.0.1] - initial Figma Make export

- Original Figma Make export: a React and Vite storefront with five sample products, a WhatsApp cart checkout, an admin page and `localStorage` data storage.
