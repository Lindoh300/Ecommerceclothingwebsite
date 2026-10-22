# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `AGENTS.md`, `docs/ROADMAP.md` and this changelog.
- Prism design system: fonts, colour and layout tokens in `src/styles/theme.css`, utility classes in `src/styles/prism.css`, and the `GooArt`, `Ticker` and `ProductImage` components in `src/app/components/prism/`.
- `.gitignore` (node_modules, dist, env files, logs, editor files).
- `package-lock.json` is now tracked.

### Changed

- Storefront reskinned to the Prism editorial style across all pages.
- Missing product images now show generative art instead of a grey "No Image" box. This partly addresses [#4](ISSUES.md#4-product-and-logo-images-are-missing).
- Header desktop nav collapses to a hamburger menu below 1024px (`lg`).
- Footer copyright year is now the current year, computed at runtime (it previously showed 2008).
- Accessibility labels added to icon-only buttons and links (cart, menu, social, remove, edit and delete).
- Header keeps the original multicolour 4Nguru logo.

### Known issues

- Admin delete button throws a `ReferenceError` and products cannot be deleted from `/admin`. See [#10](ISSUES.md#10-admin-delete-button-throws-an-error).

## [0.0.1] - initial Figma Make export

- Original Figma Make export: a React and Vite storefront with five sample products, a WhatsApp cart checkout, an admin page and `localStorage` data storage.
