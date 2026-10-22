# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `AGENTS.md`, `docs/ROADMAP.md` and this changelog.
- Prism design system: fonts, colour and layout tokens in `src/styles/theme.css`, utility classes in `src/styles/prism.css`, and the `GooArt`, `Ticker` and `ProductImage` components in `src/app/components/prism/`.
- `.gitignore` (node_modules, dist, env files, logs, editor files).
- `package-lock.json` is now tracked.
- `src/app/config/shop.ts`: single source for the WhatsApp number, phone, email and social links. Addresses [#8](ISSUES.md#8-contact-details-are-hardcoded-in-several-places).
- Cart stock limits: `addToCart` and `updateCartItem` refuse to exceed stock across all sizes and colours of a product, and the cart "+" button disables at the limit. Partly addresses [#5](ISSUES.md#5-stock-is-never-decremented-or-enforced).
- "Did you send your order?" confirmation at checkout. The cart is kept until the customer confirms. Partly addresses [#6](ISSUES.md#6-no-payment-or-order-record-at-checkout).

### Changed

- Storefront reskinned to the Prism editorial style across all pages.
- Missing product images now show generative art instead of a grey "No Image" box. This partly addresses [#4](ISSUES.md#4-product-and-logo-images-are-missing).
- Header desktop nav collapses to a hamburger menu below 1024px (`lg`).
- Footer copyright year is now the current year, computed at runtime (it previously showed 2008).
- Accessibility labels added to icon-only buttons and links (cart, menu, social, remove, edit and delete).
- Header keeps the original multicolour 4Nguru logo.

### Removed

- Default admin password hint from the admin login page, and the public footer link to `/admin`. Partly addresses [#2](ISSUES.md#2-admin-authentication-is-not-secure).
- 44 unused npm dependencies and 41 unused shadcn/ui components. Built CSS dropped from about 102 kB to about 46 kB. Addresses [#9](ISSUES.md#9-many-unused-dependencies-and-ui-components).

### Fixed

- Admin delete button now confirms, deletes the product and shows a toast, instead of throwing a `ReferenceError`. Fixes [#10](ISSUES.md#10-admin-delete-button-throws-an-error).

## [0.0.1] - initial Figma Make export

- Original Figma Make export: a React and Vite storefront with five sample products, a WhatsApp cart checkout, an admin page and `localStorage` data storage.
