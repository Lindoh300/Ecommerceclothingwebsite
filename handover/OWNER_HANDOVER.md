# Owner handover: `musa-ui-changes`

For the website owner, before merging this branch to `main`. Everything you need is in this `handover` folder; start with `README.md`.

## Where things stand

- The site at `4nguru-the-brand-online.vercel.app` is still the old one. This branch has never run on Vercel, and no pull request into `main` exists yet.
- All 21 migrations are on the live Supabase project, including the five newest: `20261031170000_delivery_admin`, `20261031180000_customers`, `20261031190000_discounts`, `20261101100000_fit_photos` and `20261101110000_fit_image_limit`. The new server function is deployed (2026-11-01). The admin Delivery, Customers and Discounts sections, the "Your fit, here" wall (placeholders until Instagram is connected) and discount codes at checkout are now deployed, but have not been tested on live: nobody has signed in to the admin or placed a real order since this deploy. The Vercel Preview test covers them. A JSON backup taken before the migrations is kept by the developer, because it holds personal data.
- Public sign-ups are off for the live project. New accounts cannot become admin.
- A clone of the GitHub repository does not include `docs/` or `AGENTS.md`. This folder holds the copies you need.

## Deploy order

Do these steps in this order. The order matters: the database updates must go first, then the server function, then the website. Do not skip step 1. This applies to any future deploy too: database updates before the function.

Steps 1 to 4 were done on 2026-11-01 and are kept as a record.

1. **Done 2026-11-01. Back up** the live Supabase database before any change, and keep the copy.
2. **Done 2026-11-01. Apply the five database updates** listed under "Where things stand": run `supabase db push` from the repo root.
3. **Done 2026-11-01. Deploy the server function:** run `supabase functions deploy make-server-fbb8f0e1 --use-api` from the repo root.
4. **Done 2026-11-01. Turn off public sign-ups:** in the Supabase dashboard, go to Authentication, Sign In / Providers, and switch off "Allow new users to sign up".
5. **Test a Vercel Preview:** open a Vercel Preview of this branch and run the "Test on the Preview URL" list below. Also check that the security headers appear in the page response: `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`.
6. **Merge to `main`**, only after steps 1 to 5 are done.

## Already live

These went straight to the live Supabase project and did not wait for a merge:

- Products, categories and stock now live in new tables. Stock is tracked per size and colour.
- GitHub `main` is still the old storefront, which keeps products and the cart in the browser and does not call this API, so these changes don't affect a site built from it. If production runs a newer build that does call the API, tell us which one; the API has been kept compatible with earlier versions of this branch.
- **Stock numbers need correcting.** Each product's total was split evenly across its sizes and colours, so counts per size are not real. After the merge, enter real counts in the admin stock grid.

- Order statuses, delivery options, order limits and order expiry are live (2026-10-30), along with a job that runs every 5 minutes.
- **Check the Orders list.** A new WhatsApp order is cancelled after 48 hours unless someone presses **Mark paid** in the admin, and its stock goes back. Orders placed before this change never expire.
- Delivery rates are placeholders: door R85, locker R55, collect R0. Set the real rates in the admin Delivery section, which is now deployed.

## Before merging

1. Open a Vercel Preview of this branch before anything reaches production, and test it (see below).
2. In Vercel, Project Settings > Build and Deployment:
   - **Framework Preset:** React Router. Change it if it says Vite.
   - **Build Command:** `npm run build`, or leave the default.
   - **Output Directory:** leave empty. It must not be `dist`.
3. In Vercel, Environment Variables, for Production and Preview:
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are required. The server now also uses them, to load products for link previews.
   - `VITE_API_BASE` is optional. Leave it unset unless you are overriding the API address.
   - `VITE_THEME` is not needed. The gallery theme is the chosen look and the default.
   - `VITE_` values are read at build time, so changing one needs a redeploy.
4. **Node version:** Node 24 is pinned in `package.json`. Leave Vercel's Node setting alone, or set it to 24.x. Vercel no longer supports Node 20.

## Decisions for you

- **Search engines:** every page has been marked `noindex, nofollow` since the original Figma export, so Google is told not to list the shop. This doesn't affect WhatsApp or Instagram previews. To open the site to search, change `ROBOTS` in `src/app/lib/seo.ts`. `/admin` stays hidden either way.
- **Preview image:** `public/images/og-default.png` is a placeholder, used for products with no photo. Replace it with the real brand image.
- **Logo:** the header now shows the 4Nguru letters and no logo image. A real logo needs adding when supplied.
- **Log retention (POPIA):** before launch, check how long Supabase keeps request logs. IP addresses used for rate limits can appear in them, even though the database tables store only a hash.
- **Event terms:** put age limits and ticket refund terms in each event's description, and confirm them before any event with alcohol.
- **T-shirt price:** the live price is R27 and the old site showed R25. Confirm which is right. Your other live prices need the same check.
- **Anyone can trigger an order email:** once email is on, anyone can type someone else's address at checkout, and that person gets an order email. Orders are limited to 5 per internet connection per hour. Decide whether that is enough, or whether customers should confirm their address first.
- **The mailing list has no confirmation step:** someone can sign up another person's address, and that person then gets your emails. A confirm-by-email step would stop this. Decide whether to add one before the first send to the list.
- **Unpaid orders hold stock for 48 hours:** someone can tie up stock on purpose by placing orders they never pay for. You can cancel them in Admin, Orders, which returns the stock. Decide how often someone checks the Orders list.

## Test on the Preview URL

1. Paste a product link into WhatsApp and check the name, description and image appear.
2. Pick a colour and check that sizes with no stock are disabled.
3. Place an order, then cancel it in the admin and check the stock returns.
4. Sign in to `/admin`, change a stock number in the grid, and add and remove a test category.
5. Check `og:url` and `og:image` in the page source use the real domain.

## Going back

- To undo the webpage, redeploy the previous production deployment in Vercel.
- The old database tables and functions are still in place, and the backups are `backup_20261030_kv` and `backup_20261030_orders`.
- Remove these only after the new site has been stable for a while.

## Switching on online payments

Online payment is built but off. Until the steps below are done, starting a payment returns "Online payment is not available", the webhook rejects every call, and WhatsApp orders work as normal. It has not been tested against Paystack, because there is no account or key yet.

4Nguru needs to supply:

1. **A Paystack account** for the business, verified and able to take ZAR. Paystack may ask for business and bank details.
2. **The Paystack secret key, set as a Supabase secret.** Never put it in `.env`, in a `VITE_` value, in the code, or in a chat. Start with the test key (it begins `sk_test_`). Whoever holds the key runs this from the repo root, then switches to the live key once a test payment works:

   ```bash
   supabase secrets set PAYSTACK_SECRET_KEY=<the key> --project-ref siyupxcmfbjhpbhlpxsg
   ```

3. **The webhook URL, entered in Paystack's dashboard** (Settings, API Keys & Webhooks):

   ```
   https://siyupxcmfbjhpbhlpxsg.supabase.co/functions/v1/make-server-fbb8f0e1/payments/webhook
   ```

4. **Optional:** the page customers return to after paying is now built from the `SITE_URL` secret (see "Switching on order emails"). `SITE_URL` replaces the old `PAYSTACK_CALLBACK_URL`, which the function no longer reads.

### Required step: the webhook is blocked today

The deployed function has `verify_jwt` turned on, so Supabase refuses any request without a Supabase token before our code runs. Paystack can't send one. Checked on the live function on 2026-10-30: a request with no `Authorization` header gets 401 `UNAUTHORIZED_NO_AUTH_HEADER`, so a Paystack webhook would never arrive. This setting has not been changed.

Decided on 2026-10-31: it stays on until Paystack starts. **When the Paystack key is set, turn `verify_jwt` off for this function.** Set `verify_jwt = false` under `[functions.make-server-fbb8f0e1]` in `supabase/config.toml`, then redeploy. The webhook checks Paystack's signature itself, and every admin route checks the admin role itself, so nothing protected relies on this gate. The public routes stop requiring the anon key, which is public anyway.

### Then test it

1. With the test key, the webhook URL and the step above done, make one sandbox payment and check the order turns **paid** in the admin. Only then is P3.3 closed.
2. "Pay online" appears at checkout, and "Pay now" on an order awaiting payment, once the key is set and this branch is deployed. Customers can't reach either before then.

## Switching on order emails

The shop can email customers when their order is received, when payment is received and when it ships. It is off until you set the secrets below. Without them, orders, payments and the admin all work as before and no email is sent. An email that fails to send never affects the order. Only customers who gave an email address get one.

What is needed:

1. **A Resend account** (resend.com).
2. **A verified sending domain** in Resend, so mail comes from an address like `orders@your-domain` and is not marked as spam.
3. **Three secrets**, set from the repo root by whoever holds the keys. Never put them in `.env`, in a `VITE_` value, in the code, or in a chat:

   ```bash
   supabase secrets set RESEND_API_KEY=<the Resend API key> --project-ref siyupxcmfbjhpbhlpxsg
   supabase secrets set EMAIL_FROM="4Nguru <orders@your-domain>" --project-ref siyupxcmfbjhpbhlpxsg
   supabase secrets set SITE_URL=<the live site address, e.g. https://your-domain> --project-ref siyupxcmfbjhpbhlpxsg
   ```

   `SITE_URL` is the live address without a trailing slash. It puts the "view your order" link in each email. It also sets the page customers return to after paying online, so it **replaces the optional `PAYSTACK_CALLBACK_URL`**.

Email needs both `RESEND_API_KEY` and `EMAIL_FROM`; if either is missing, no email is sent. `SITE_URL` alone only adds the payment return page.

### Sending to the mailing list

The admin Community section has **Send to the list**. It stays off until all three secrets above are set, because every email must carry an unsubscribe link. Write a subject and message, send a test to yourself, then send. Only people with an email address get it; for people who gave only a phone number, use the subscriber export. Keep the page open until it finishes. If it stops, **Continue** picks up where it left off. If the send stops partway through a batch, those few people are not retried, so nobody gets it twice.

Resend's plan limits how many emails you can send a day. Check them against the size of your list. The first real send should be a small one.

## Restock requests and WhatsApp updates

Neither needs any setup. Customers can leave a phone number or email on a sold-out size or colour. They appear in the admin Community section under **Restock requests**. When an item is back, use **Message on WhatsApp** or **Send email**, then **Mark as told** to remove the request. Requests are deleted after 180 days once new requests come in. In Orders, **Message on WhatsApp** opens your WhatsApp with an update for that order, which you send yourself.

## Discount codes

Create codes in the admin Discounts section. Each code is a percentage or a fixed amount, with an optional minimum spend, expiry date and use limit. Customers enter a code at checkout. It comes off the goods, never the delivery, and an order takes one code at most.

If an order that used a code is cancelled or expires, the code gets its use back. A code can be turned off but not deleted. A code that is used up or expired gets the same "This code isn't valid" message as a code that doesn't exist.

You can also enter a code on the admin New order screen.

## Connecting Instagram to the Your fit wall

The "Your fit, here" wall on `/community` shows photos people tag the shop in on Instagram. It stays on placeholders until you connect Instagram. Nothing is shown and no photo is copied until both secrets below are set.

What is needed:

1. **Why it is off:** the wall reads Instagram with a Meta access token, and none is set yet.
2. **What is needed:**
   - The @4nguruthebrand Instagram account, set to a Business or Creator account and linked to a Facebook Page.
   - A Meta developer app with the Instagram Graph API.
   - A token with these permissions: `instagram_basic`, `instagram_manage_comments` and `pages_read_engagement`. Add `ads_read` if the Page role came through Business Manager.
   - The Instagram account's user id.
3. **Use a system user token:** a token from a Meta system user in Business Manager is the better choice. An ordinary long-lived token runs out (about 60 days, according to third-party guides; check Meta's current docs), and then the wall stops updating. The admin shows "Instagram didn't answer on the last check" when that happens.
4. **Steps, in order:**
   1. Set the secrets from the repo root, by whoever holds the keys. Never put them in `.env`, in a `VITE_` value, in the code, or in a chat:

      ```bash
      supabase secrets set INSTAGRAM_ACCESS_TOKEN=<the Meta token> --project-ref siyupxcmfbjhpbhlpxsg
      supabase secrets set INSTAGRAM_USER_ID=<the Instagram user id> --project-ref siyupxcmfbjhpbhlpxsg
      ```

   2. No redeploy is needed after setting the secrets. The two fit database updates, `20261101100000_fit_photos.sql` and `20261101110000_fit_image_limit.sql`, are already applied on live (2026-11-01).
   3. Open Admin, Community, Your fit wall, and press **Check Instagram now**.
5. **How to test:** tag the account in a public photo, press the button, and see the photo on `/community`. This has not yet been tested against the real Instagram API. Meta's docs do not say whether the API returns the newest posts first. The sync reads the first 25 posts and sorts them itself, so check this in the test.
6. **Decisions for you:**
   - Photos appear with no approval step, so anyone's public tag can reach the site. **Hide** takes one down at once.
   - Photos belong to the people who took them. The wall credits and links each one. Copying someone's photo to our site for marketing is not clearly covered by their posting it on Instagram. Check this with someone who knows the law, and ask customers when in doubt. The Privacy page now has a draft section, "Photos you tag us in", which you need to confirm.

## Legal pages removed for now

The Terms page and the consumer-law wording on Returns were taken off on 2026-10-31 until someone qualified can confirm them. Customers keep their rights under South African law either way, and Returns says its conditions do not limit them. Privacy is now a short notice. It still shows a draft notice until you confirm it.

People can leave the mailing list at `/unsubscribe`, linked from the footer and Privacy. Anyone who knows a phone number or email on the list can remove it. That changes nothing on an order, and the person can simply sign up again.

## Sample data is in the live database

The shop was filled with sample content on 2026-10-31 so it could be reviewed with real-looking pages. It is not real stock or real events.

- 21 sample products, plus stock photos on your five products. Your five products' names, prices and stock did not change.
- Five sample events, including paid tickets that point customers to your WhatsApp, and eight gallery photos.
- 43 Unsplash stock photos in `product-images/demo/`. The people and events in them have nothing to do with 4Nguru.

Remove it before taking real orders, using `demo-data/README.md`. `remove.sql` deletes the sample products, events and gallery items and takes your five products back to no photos. It stops without changing anything if a real order includes a sample product. Any RSVP made to a sample event is deleted with it.

Your "December 16 Event" is no longer on the live site (checked 2026-10-31). If you did not delete it, tell us: it can be restored from the backup. Its photo is still in Storage.

## Please confirm the details copied from the old site

These came from the old test site (`4nguru-the-brand-online.vercel.app`) on 2026-10-31 and are on the site as drafts:

- Delivery usually takes 3-5 working days, nationwide. This is the old "Standard" time.
- Returns or exchanges within 30 days of delivery, unworn and in original packaging, with return shipping paid by the customer unless the item is faulty.
- Size measurements for S to XL. There are none for XXL, although some products come in XXL.
- Support hours: Monday to Friday, 9am - 5pm.
- The About story and values, including the Sustainability value.

Left out until you confirm them: "since 2014" (the old footer said 2008), "trusted by thousands", "over 10 years", the small local workshop, eco-friendly packaging, ethical sourcing and "finest fabrics".

Delivery fees: the old site showed Standard R100, Express R150 and free over R1000. Checkout charges door R85, locker R55 and collect R0, which are still placeholder rates. Set the real rates in the admin Delivery section, which is now deployed.
