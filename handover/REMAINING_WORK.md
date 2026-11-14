# Remaining work

Pulled on 2026-10-31 from ROADMAP.md, PLATFORM_PLAN.md, MORNING_REVIEW.md, OWNER_HANDOVER.md and ISSUES.md, and checked against the code. Baseline before this work: 246 Deno tests, 220 SQL tests, typecheck and build all pass.

## Status (2026-11-01)

- **Latest test counts:** 479 frontend, 349 Deno and 367 SQL tests, on the pushed branch.
- **Branch work:** `musa-ui-changes` is pushed, not merged, with no pull request into `main` yet. Commit by name only.
- **Live:** all migrations and the edge function (2026-11-01).
- **In progress, not committed:** a discount code field on the admin New order screen. The code is in the working tree but has not been reviewed.
- **`npm audit`:** no high or critical findings; 6 moderate and 2 low remain.
- **Not verified on a real page:** the admin load failure screen with a truly failed chunk load (tested with a simulated one), the checkout Summary discount row and the desktop orders table discount line (component tests only), and real concurrency on the last use of a code (PGlite has one connection).

## Not started

- **Event drops:** the owner links products to an event, and the event page shows them.

## Closed by earlier decisions

- **Stock alert messages:** covered by restock requests and the dashboard's low-stock list. Automatic sending needs an outside account.
- **Paid orders can only be refunded:** this is how the order rules are meant to work. Refunds not returning stock is MORNING_REVIEW item 2, which stands.
- **`/ticket/:code` and `/order/:id` answering 200 for a missing code:** left alone. A fix needs server loaders on both pages, AGENTS.md says not to add those without asking, and the site is `noindex`.

## Waiting on Paystack

MORNING_REVIEW item 1 stands: these change the order functions that handle real stock, so they wait for real payments.

- Online paid tickets
- Mixed cart
- Bundles

## Blocked on an outside account or the owner

| Item | Needs |
|---|---|
| Sandbox payment (P3.3) | Paystack account and key, then `verify_jwt` off |
| Real email and list-send test | Resend account, verified domain, secrets |
| Courier labels | Bob Go account |
| Automatic WhatsApp messages | Meta WhatsApp Business account |
| One-time PIN order lookup | SMS or WhatsApp provider |
| Visitor analytics | Owner's choice of tool, then a Privacy update |
| Real photos, logo, preview image (P1.5) | Owner |
| Real delivery rates, prices, stock counts | Owner. Rates and stock can then be entered in the admin |
| Draft wording, event terms, log retention | Owner |
| Search engines (`ROBOTS`) | Owner's decision |
| December 16 Event | Owner to say whether they deleted it |
| Vercel Preview and merge | Owner |
| Removing sample data | Before real trading |
| Removing old `kv` rows, old order functions, backup tables | After the owner has deployed and it has been stable |
