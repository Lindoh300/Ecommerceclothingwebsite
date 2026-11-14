# Test plan: 4Nguru The Brand

A manual test plan for the shop owner or a tester. Run it on the Vercel Preview before the site goes live.

> **WARNING: the Preview uses the LIVE database.**
> Every test order, RSVP, sign-up, restock request and discount code you create is a real row in the live Supabase project. Test orders take real stock, and test sign-ups can end up on the real mailing list.
>
> - Put the name **TEST ORDER** in every name field you fill in (customers, ticket holders, subscribers). Use your own phone number or one you control, never a stranger's.
> - Do not give a real customer's email address.
> - When you finish, do every step in [Clean up after testing](#7-clean-up-after-testing).
> - The sample products, events and gallery photos on the site are expected for now. They are removed before real orders (see [After sample data removal](#5-after-sample-data-removal)).

## 1. How to use this plan

**Who:** the shop owner, or anyone helping. You do not need to know code.

**What you need:**

- A phone (Android or iPhone) with a camera and WhatsApp installed.
- A computer with Chrome, Safari or Firefox.
- The Vercel Preview link for this branch (ask the developer; write it here: ____________________).
- The admin email and password. Keep them private. Never paste them into a chat or a report.
- A second WhatsApp contact or group, so you can paste links and see the preview.
- A printer, or the "Save as PDF" option in the print window.

**How to mark a test:** write one word in the Pass/Fail column.

- **Pass:** you saw exactly the expected result.
- **Fail:** you saw something different, or an error, or a broken page.
- **Blocked:** you could not do the test (for example, a limit was hit, or something it needs is switched off). Say why in Notes.

**How to report a failure.** For each Fail, write down:

1. The test ID (for example SHOP-03).
2. The page address (the URL in the address bar).
3. What you did, step by step.
4. What you expected and what you saw instead.
5. A screenshot. On a phone, take a screenshot of the screen. Note whether it was phone or computer, and which browser.

Do not include passwords or customers' private details in a screenshot.

**Limits that can block you.** These protect the shop from abuse. If you hit one, wait an hour or use a different connection (for example, mobile data instead of Wi-Fi), and mark the test Blocked until then.

| What | Limit |
|---|---|
| Orders | 5 per internet connection per hour |
| Units in one order | 10 |
| Free ticket RSVPs | 5 per connection per hour |
| Mailing list sign-ups, unsubscribes and restock requests together | 5 per connection per hour |
| Order lookups on Track an order | 10 per connection per hour |
| Discount code attempts (quotes and orders together) | 20 per connection per hour |

Plan your order tests so you do not use all five in one go. Orders the owner creates in the admin do not count towards the limit.

**WhatsApp orders expire.** A WhatsApp order that is not marked paid is cancelled automatically after 48 hours and its stock goes back. Use Extend 48h to give it longer, or Mark paid to keep it.

**Things that are switched off until accounts exist.** These cannot be tested yet. They are in separate "Only after setup" sections near the end: Paystack online payment, Resend email and sending to the list, and the Instagram fit wall. While they are off, "Pay online" is not shown at checkout, no emails are sent, and the fit wall shows placeholder tiles.

## 2. Priority key

| Priority | Meaning |
|---|---|
| **P1** | Must pass before launch. |
| **P2** | Should pass. A Fail needs a decision from the owner. |
| **P3** | Nice to have. |

**Launch rule: every P1 test must pass.** One P1 Fail or Blocked means the site does not go live until it is fixed and the test is repeated. Tests marked Blocked because something is switched off do not count against launch, but must be run when that thing is switched on.

## 3. Tests

### 3.1 Deployment and basics (DEP)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| DEP-01 | P1 | Open the Preview link in a computer browser. | The home page loads fully, with the header, products or tiles and the footer. No error page. | | |
| DEP-02 | P1 | Visit each of these by typing the path after the Preview address: /shop, /events, /community, /cart, /checkout, /track, /about, /customer-service, /privacy, /returns, /delivery, /size-guide, /unsubscribe. | Every page loads with the site header and footer and a heading. None shows a blank page or a technical error. | | |
| DEP-03 | P1 | Visit /tshirts, /jerseys, /shorts, /pants and /accessories. | Each shows a category page with products (or an honest empty message). None shows Page not found. | | |
| DEP-04 | P1 | Visit /this-page-does-not-exist. | A page saying Page not found, with a Go home style link, inside the normal header and footer. Pressing the link returns to the home page. | | |
| DEP-05 | P2 | Visit /product/nope. | The page says Product not found, still in the normal site layout. | | |
| DEP-06 | P2 | Visit /event/nope and /ticket/nope. | Event not found and Ticket not found messages, in the normal layout. | | |
| DEP-07 | P2 | Look at the browser tab on a computer. | A small icon (favicon) shows next to the page title. The title on the shop page reads like "Shop | 4Nguru". | | |
| DEP-08 | P1 | Go to a free header checker (search for "security headers check"), enter the Preview address, and run it. Or open the browser developer tools (F12), Network tab, reload, click the first request and read Response Headers. | The response includes Content-Security-Policy with frame-ancestors 'none', X-Frame-Options: DENY, X-Content-Type-Options: nosniff and Referrer-Policy: strict-origin-when-cross-origin. | | |
| DEP-09 | P2 | Open the page source (right-click, View page source) on the home page and on a product page. Search for "robots". | The page is marked noindex, nofollow. This is deliberate for now: search engines are told not to list the shop. | | |
| DEP-10 | P1 | Open the browser developer tools Console tab. Reload the home page, /shop, a product and /cart. | No red errors about missing files, CORS or "API not configured". (Grey or yellow notes are fine.) | | |
| DEP-11 | P1 | Look at the home page, /shop, /cart, /events, /community and /admin with images switched on. | Every page is styled in the shop's look. There is no plain unstyled text, no broken layout and no giant images. | | |
| DEP-12 | P1 | Open the Preview in a private (incognito) window. | Products appear (no "API not configured" message). Products load without signing in. | | |
| DEP-13 | P2 | Open the page source of the home page and look for "og:url" and "og:image". Do the same for a product page. | The addresses use the Preview's real address, not "localhost". | | |

### 3.2 Home (HOME)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| HOME-01 | P1 | Open the home page. | The 4Nguru wordmark with its coloured letters shows in the header. The page shows hero and tile sections, "Shop by category" and links to events and community. | | |
| HOME-02 | P1 | Press the header links one at a time (Shop, Events, Community and the others shown). | Each goes to the right page. The browser Back button returns to the home page. | | |
| HOME-03 | P2 | Press Shop all (or the main shop button) on the home page. | You land on /shop with products listed. | | |
| HOME-04 | P2 | Press a category tile on the home page. | You land on a page for that category with only its products. | | |
| HOME-05 | P2 | Look at the gallery and event sections on the home page. | Photos load. A missing photo shows a plain tile saying No photo, never a broken image symbol. | | |
| HOME-06 | P2 | Scroll to the footer. | Footer links work: Track an order, Size Guide, Delivery and returns, Privacy, Unsubscribe, Contact Us and social links. A Staff sign in link is there and is the only link to the admin. | | |
| HOME-07 | P2 | Press the WhatsApp contact link in the footer or on Customer Service. | WhatsApp opens a chat with the shop's number. | | |

### 3.3 Light and dark mode (MODE)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| MODE-01 | P2 | Press the light/dark button in the header (its label says Switch to dark mode). | The whole page turns dark (warm near-black with cream text). The button label changes to Switch to light mode. | | |
| MODE-02 | P2 | In dark mode, reload the page, then open /shop, a product, /cart and /checkout. | Dark mode stays on. There is no bright white flash while the page loads. | | |
| MODE-03 | P2 | In dark mode, read the text on /shop, /cart, /checkout, /events, a product page and the footer. | All text is easy to read. No white boxes, no text that fades into the background, input boxes are visible. | | |
| MODE-04 | P3 | Open /admin and press the toggle there if it is shown. | The admin is readable in both modes. | | |
| MODE-05 | P3 | Press the button again to go back to light. Close and reopen the browser. | Light mode returns and stays. The page starts light unless dark was your last choice. | | |

### 3.4 Shop and filters (SHOP)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| SHOP-01 | P1 | Open /shop. | A grid of products with names and prices in Rand (R). Sample products appear until they are removed. | | |
| SHOP-02 | P1 | Use the Category dropdown to choose one category. | Only products from that category show. The category list shows a count next to each name. | | |
| SHOP-03 | P1 | Choose a Size in the Size dropdown. | Only products that come in that size show. | | |
| SHOP-04 | P2 | Choose a Colour in the Colour dropdown. | Only products in that colour show. | | |
| SHOP-05 | P2 | Tick the in-stock tick box. | Products that are completely sold out disappear. | | |
| SHOP-06 | P2 | Change Sort to Price: low to high, then Price: high to low, then Newest. | The order follows the choice: cheapest first, dearest first, then newest first. | | |
| SHOP-07 | P2 | Combine a category, a size and a sort. Then use the clear or reset option. | The list matches all filters at once. Clearing returns the full list. | | |
| SHOP-08 | P2 | Type a word from a product name or colour in the search box (for example a colour). Then type a word that matches nothing. | Matching products show. A nonsense word shows an honest "no products" message, not an error. | | |
| SHOP-09 | P3 | Apply a filter and press the browser Back button, then Forward. | The filters and list return to what they were. The address carries the filter so it can be shared. | | |
| SHOP-10 | P2 | Pick filters that match nothing. | A friendly message says there is nothing to show and a way to clear filters. | | |

### 3.5 Product page (PROD)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| PROD-01 | P1 | Open any product from the shop. | Photos, name, price in R, description, colour and size choices and an add to cart button show. | | |
| PROD-02 | P1 | Pick a colour. Look at the size buttons. | Sizes with no stock in that colour are disabled (greyed out and not clickable). | | |
| PROD-03 | P2 | If the product has several photos, use the next and previous image buttons. | The photo changes each time and wraps sensibly. | | |
| PROD-04 | P1 | Try to add to cart without choosing a size and colour. | The page asks you to choose options (a message such as Choose options). Nothing is added. | | |
| PROD-05 | P1 | Pick a colour and size, set quantity 1, add to cart. | A confirmation shows and the cart count in the header goes up by 1. | | |
| PROD-06 | P2 | Open a product by its short name address (slug), for example /product/classic-cotton-t-shirt, and by its number address. | Both open the same product. | | |
| PROD-07 | P2 | Find a size and colour that is out of stock. Open the Tell me when it's back form, enter TEST ORDER as the name and your own phone number, and press Notify me. | A thank-you message appears: Thanks. We'll tell you when it's back. (This uses one of the 5 shared sign-up and restock actions.) | | |
| PROD-08 | P2 | On the same form, enter a phone number that is clearly wrong (for example 123) and submit. | A message says the phone number doesn't look right. No request is made. | | |
| PROD-09 | P3 | Scroll down a product page. | You might also like shows other products. Pressing one opens it. | | |
| PROD-10 | P2 | Check any product with low stock. | A Low stock mark may show. A fully sold-out product shows Sold out. | | |

### 3.6 Cart and stock limits (CART)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| CART-01 | P1 | Open /cart with nothing in it (use a private window). | Your cart is empty, with a way back to the shop. | | |
| CART-02 | P1 | Add two different products and open /cart. | Both lines show name, size, colour and quantity. The items total and Estimated total are in Rand and match the prices on the product pages. | | |
| CART-03 | P1 | Press the plus button on a line. Then the minus button. | Quantity and totals update each time. Minus at 1 does not go below 1. | | |
| CART-04 | P1 | Keep pressing plus until you reach the stock for that size and colour (or try a quantity above the stock). | You cannot go over stock. A message says you already have all available. | | |
| CART-05 | P2 | Remove a line from the cart. | The line goes and totals update. Removing the last line shows the empty cart message. | | |
| CART-06 | P1 | Add items, then reload the page. Close the tab and open the shop again. | The cart and the header count are still right. | | |
| CART-07 | P2 | Open the shop in two tabs. Add an item in one. Look at the header in the other, then reload it. | The count in the other tab is right after reload. | | |
| CART-08 | P2 | Look at the cart prices. | Delivery is not added here (the page says delivery is added at checkout). | | |
| CART-09 | P3 | On the cart page, open the Rand price of an item and compare with admin Products. | The price is the same as in admin. (If the live price differs from what the owner expects, report it. The owner is checking old prices such as the R27 T-shirt.) | | |
| CART-10 | P2 | Add the same item to the cart a second time with the same size and colour. | The line's quantity goes up. It does not make a second line. | | |

### 3.7 Checkout with WhatsApp (CHK)

Use the name TEST ORDER. Each order counts towards the limit of 5 per hour and takes stock until cancelled.

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| CHK-01 | P1 | Add one item and press the checkout button on the cart page. | /checkout opens with Your details, your order lines and totals. | | |
| CHK-02 | P1 | Press Place order with all fields empty. | Fields are highlighted and messages ask for a name and a valid phone number. No order is made. | | |
| CHK-03 | P1 | Enter a name, a phone number with fewer than 7 digits, and press Place order. | A message asks for a valid phone number (at least 7 digits). | | |
| CHK-04 | P1 | Enter TEST ORDER as the name and your phone number. Choose a delivery option (see DEL tests) and fill in the address it asks for. Press Place order. | The button shows Placing order, then Order sent. A reference for the order shows. The page says your order is saved first and asks you to send it on WhatsApp. | | |
| CHK-05 | P1 | Press Send on WhatsApp. | WhatsApp opens (on a phone, the app; on a computer, WhatsApp Web) with a message that starts with "Hi! I've placed order" and the reference, name, lines and the total. It opens in one click without a pop-up block. | | |
| CHK-06 | P1 | Check the total in the WhatsApp message against the page. | They match, including delivery. | | |
| CHK-07 | P1 | After sending, return to the page. | A panel asks Did you send your order? with Yes, clear cart and Not yet. | | |
| CHK-08 | P1 | Press Not yet. Reload /cart. | The cart still has the items. | | |
| CHK-09 | P1 | Press Yes, clear cart. | The cart is emptied and the header count goes to 0. | | |
| CHK-10 | P1 | Try to place a second order straight away with the page left on the same order (double-click Place order quickly on a fresh order). | Only one order is created. You do not get two references. | | |
| CHK-11 | P2 | Add 11 units (for example 11 of one item, or several items adding up to 11). Try to place the order. | The order is refused with a message about too many items in one order. The limit is 10 units. | | |
| CHK-12 | P2 | Add a long note (over 500 characters) and submit. | A message says the note is too long (500 characters max). | | |
| CHK-13 | P2 | Use a name over 80 characters. | A message asks for a name of up to 80 characters. | | |
| CHK-14 | P2 | Place orders until you have placed 5 within one hour, then try a 6th. | The sixth is refused with a message that the order limit is reached. Mark Blocked and try again after an hour. | | |
| CHK-15 | P1 | After placing an order, open the admin Orders list. | The order is there as Pending, with your TEST ORDER name, the lines and the same total. Stock for the items went down. | | |
| CHK-16 | P2 | Look at the checkout page in a browser where you are not signed in to anything. | Pay online is not listed (online payment is off until Paystack is set up). Only the WhatsApp way shows (labelled Pay on WhatsApp). | | |
| CHK-17 | P2 | Start checkout with a product that another tester just bought the last of (or set the stock to 0 in admin while the cart still holds it). Press Place order. | A message says some items are no longer available in that quantity and names the products. No order is created. | | |

### 3.8 Delivery options (DEL)

Delivery rates on the live site are placeholders until the owner sets them: door R85, locker R55, collect R0. Check against what the admin Delivery section says now.

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| DEL-01 | P1 | At checkout, look at the delivery choices. | Door delivery, locker and collect (or the options the admin has switched on) show with prices in R that match the admin Delivery section. | | |
| DEL-02 | P1 | Choose door delivery and leave the address empty. Press Place order. | Messages ask for street address, suburb, city and a 4 digit postal code. | | |
| DEL-03 | P1 | Enter a postal code with 3 or 5 digits. | A message asks for a 4 digit postal code. | | |
| DEL-04 | P1 | Choose locker and leave the locker field empty. | A message asks for the locker name or code. | | |
| DEL-05 | P1 | Choose collect. | No address is needed. The delivery price is the collect price (R0 unless changed). | | |
| DEL-06 | P1 | Switch between options and watch the total. | The total changes by the option's price each time: items total plus delivery. | | |
| DEL-07 | P2 | In the admin Delivery section, change the door price to a new value, save, reload /checkout. Change it back afterwards. | The new price shows at checkout and in the order's total. (Record the old price first.) | | |
| DEL-08 | P2 | In the admin Delivery section, switch an option off, reload /checkout, then switch it back on. | The option disappears while off and returns when on. | | |

### 3.9 Discount codes at checkout (DISC)

First create the codes in admin (see ADM-DSC tests). Test codes are real. Turn them off in clean-up.

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| DISC-01 | P1 | At checkout, open Have a discount code?, type TESTCODE10 (a 10 percent code you made) and press Apply. | The discount shows, taken off the items total. The new total is lower by 10 percent of the goods. | | |
| DISC-02 | P1 | Check that delivery is unchanged after the code. | The discount does not reduce the delivery price. | | |
| DISC-03 | P1 | Type a code that does not exist. | A message that the code is not valid (That code is not valid). | | |
| DISC-04 | P1 | Use a code you have turned off, and one with a past expiry date. | The same not valid message. The shop never says whether the code exists. | | |
| DISC-05 | P2 | Use a fixed Rand-off code with a minimum spend, with an order below the minimum. | The code is refused with a message about the minimum spend. | | |
| DISC-06 | P2 | Use a code with use limit 1. Place an order with it, then try it again on a new order. | The first order works. The second says the code is not valid. | | |
| DISC-07 | P2 | Place an order using a code, then cancel that order in admin. Try the use-limited code again. | The code gets its use back after cancel and works again. | | |
| DISC-08 | P1 | Place an order with a code, then check the WhatsApp message and admin Orders. | The total sent is the discounted total. Admin shows the same total. | | |
| DISC-09 | P3 | Apply a code, then change the cart quantity and re-check. | The total recalculates with the code still applied (or asks to apply again). It never shows a wrong total. | | |
| DISC-10 | P3 | Make 21 code attempts within an hour (for example, type wrong codes repeatedly). | After the limit a "try again later" style message appears. Mark Blocked after this test for an hour. | | |

### 3.10 Order status and tracking (TRK)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| TRK-01 | P1 | After placing a test order, press View order status (or open /order/ followed by the order's id from the link). | The order page shows the reference and a progress bar with Placed, Paid, Packed, Shipped, Delivered. Placed is the current step. | | |
| TRK-02 | P1 | Open /track. Enter the order reference and the phone number you used. Press Find my order. | The same order status page shows. | | |
| TRK-03 | P1 | On /track, enter the right reference but a wrong phone number. | A message says we couldn't find that order and to check the reference and phone number. It does not hint which was wrong. | | |
| TRK-04 | P2 | Press Find my order with both fields empty. | A message asks you to enter the reference and phone number. | | |
| TRK-05 | P1 | In admin, Mark paid on the test order. Refresh the order page. | Paid is now the current step. | | |
| TRK-06 | P1 | In admin, move the order to Packed, then Shipped, and save tracking details (courier, number and an https:// link). Refresh the order page. | The steps move on. Under Shipped the page shows the tracking number and a link that opens the tracking address. | | |
| TRK-07 | P2 | In admin, cancel a different test order. Open its order page. | It says This order was cancelled. | | |
| TRK-08 | P2 | Look up an order 11 times within an hour (use wrong numbers). | After 10 lookups, a message asks you to try again later. Mark Blocked after this test for an hour. | | |
| TRK-09 | P2 | After a test order's 48 hours pass without payment (or leave one overnight), open it. | It says This order was not paid in time and has expired. (Only run if time allows; otherwise note Blocked.) | | |

### 3.11 Events, RSVP and tickets (EVT)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| EVT-01 | P1 | Open /events. | A list of upcoming events with poster, title, date and time, and a price line. Sample events show until removed. | | |
| EVT-02 | P1 | Open an event. | The event page shows a date and time in South African time, a place and details. | | |
| EVT-03 | P1 | Open an event with a free ticket type. Set how many tickets (1 or 2), enter TEST ORDER as the name and your phone number, press Reserve free tickets. | A message says You're in. A ticket with a QR code and a ticket link is shown for each ticket. | | |
| EVT-04 | P1 | Open a ticket link (/ticket/ plus the code). | The page shows Your ticket, a QR code and the holder's first name only. No phone number or email is shown. | | |
| EVT-05 | P2 | Press Reserve free tickets with the name left empty. | A message says Enter your name. | | |
| EVT-06 | P2 | Enter a phone number with under 7 digits and no email. | A message about the phone number. | | |
| EVT-07 | P2 | Enter both a bad email and a phone number. | A message says the email address doesn't look right. | | |
| EVT-08 | P1 | Open an event with a paid ticket type. | The page shows Get tickets on WhatsApp rather than a reserve button. Pressing it opens WhatsApp with a message about the event. | | |
| EVT-09 | P2 | Reserve more tickets than are left (or after the type is sold out). | A message says Sorry, these tickets are sold out. | | |
| EVT-10 | P2 | Make 6 RSVPs within an hour. | After 5, a message asks you to try again later. Mark Blocked after this test for an hour. | | |
| EVT-11 | P2 | In admin, set an event to Draft (hidden) or Cancelled. Open its /events list and its address. | It does not show in the list. Its page says event not found or no longer available. Set it back to Published afterwards. | | |
| EVT-12 | P3 | Look at an event with no end time after it is over. | It moves out of the upcoming list at about 6 hours after it starts. | | |
| EVT-13 | P2 | Open /ticket/ with a made-up code. | The page says Ticket not found and to check the link you were sent. | | |
| EVT-14 | P3 | Look at the event page for age limits and refund terms. | The terms the owner wrote in the event description show. (The owner must add these, especially for events with alcohol.) | | |

### 3.12 Door check-in on a real phone (DOOR)

Do this on a real phone, with the camera, ideally standing a metre or two from a screen showing the ticket.

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| DOOR-01 | P1 | On the phone, sign in at /admin. Open the Door section and choose a test event. | The event's door screen opens. It says it is downloading the ticket list, then it is ready. | | |
| DOOR-02 | P1 | Press Scan with camera. Allow camera access when the phone asks. | The camera view opens and the button changes to Stop camera. | | |
| DOOR-03 | P1 | On a second device or a printout, show the QR code of a valid test ticket. Point the camera at it. | The ticket is accepted. The screen shows the name and Checked in. | | |
| DOOR-04 | P1 | Scan the same ticket again. | The screen says the ticket was already checked in. | | |
| DOOR-05 | P1 | Void a different ticket in admin (Events, Tickets). Scan it at the door. | The screen says the ticket is void. It is not accepted. | | |
| DOOR-06 | P2 | Scan a ticket for a different event. | The screen says it is for another event. | | |
| DOOR-07 | P2 | Type a ticket code (or paste a ticket link) into the Ticket code or link box instead of using the camera. | The result shows exactly as when scanning. | | |
| DOOR-08 | P2 | Refuse the camera permission when the phone asks. | A message says the permission was refused and to type the code below. Typing still works. | | |
| DOOR-09 | P1 | Switch the phone to airplane mode, then scan or type a valid, unused ticket. | The scan is saved on the phone (Saved offline, will sync). The door keeps working. | | |
| DOOR-10 | P1 | Switch airplane mode off. Wait a short while. | The saved scans sync. The admin Tickets list for that event shows these tickets as checked in. | | |
| DOOR-11 | P2 | Offline, scan a ticket that was already checked in before you went offline, then go online. | The list of offline scans the server did not accept shows it. | | |
| DOOR-12 | P2 | Press Stop camera. | The camera light on the phone goes off. | | |
| DOOR-13 | P3 | Try scanning in low light and in bright sun. | Scanning may be slower, but typing the code is always a fallback. Note how it went. | | |

### 3.13 Community page and fit wall placeholders (COM)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| COM-01 | P1 | Open /community. | Sections show: upcoming events, a gallery, Your fit, here, and the mailing list sign-up. | | |
| COM-02 | P1 | Look at the gallery. | The gallery photos from the admin Community section show (sample photos until removed). | | |
| COM-03 | P1 | Look at Your fit, here while Instagram is not connected. | Placeholder tiles with text such as Your photo here, and the line asking people to wear it, post it, tag us. No broken images and no error. | | |
| COM-04 | P2 | Press an upcoming event on the Community page. | The event page opens. | | |
| COM-05 | P2 | Press the Instagram and community WhatsApp links on the page. | Each opens the right account or chat. | | |
| COM-06 | P3 | Open /community with an empty gallery (only if the admin has none). | A friendly message such as Photos from our events will appear here. | | |

### 3.14 Mailing list, unsubscribe and restock requests (LIST)

All three share one limit of 5 per connection per hour. Use TEST ORDER as the name.

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| LIST-01 | P1 | On /community, read the sign-up form. | A consent tick box states what you agree to. The list sign-up cannot be sent without ticking it. | | |
| LIST-02 | P1 | Enter TEST ORDER and your own phone number. Tick consent. Press Join the list. | A message says You're on the list. | | |
| LIST-03 | P1 | Try to submit with no phone or email. | A message asks for a phone number or an email address. | | |
| LIST-04 | P2 | Enter a wrong email such as "abc". | A message says the email address doesn't look right. | | |
| LIST-05 | P1 | In admin, Community, Subscribers, find the test person. | The entry shows with the contact, the source and the date. | | |
| LIST-06 | P1 | Open /unsubscribe. Enter the phone number you signed up with and press Unsubscribe. | A message says that if that contact was on the list, it has been removed and you won't get any more news. | | |
| LIST-07 | P1 | Enter a phone number that was never on the list. | The very same message as LIST-06. It never says whether a number is on the list. | | |
| LIST-08 | P2 | Check admin Subscribers after LIST-06. | The test person is shown as opted out. | | |
| LIST-09 | P2 | Press Unsubscribe with the field empty. | A message asks for a phone number or an email address. | | |
| LIST-10 | P2 | Make more than 5 sign-ups, unsubscribes and restock requests in an hour. | After 5, a message asks you to try again later. Mark Blocked after this test. | | |
| LIST-11 | P2 | Open the footer Unsubscribe link and the link from the Privacy page. | Both open /unsubscribe. | | |
| LIST-12 | P2 | In admin, find the restock request from PROD-07 in Community, Restock requests. | It shows the contact, the product, size and colour. | | |
| LIST-13 | P2 | Press Message on WhatsApp on the request. | WhatsApp opens with a message saying the item is back. | | |
| LIST-14 | P2 | Press Mark as told. | The request is removed and Marked as told shows. | | |

### 3.15 Help and legal pages (INFO)

The owner is still confirming several details. Items marked "To be confirmed" must stay until the owner supplies the facts. They must never be replaced with guesses.

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| INFO-01 | P1 | Open /privacy. | A short notice shows with a draft notice saying This page is a draft and is being reviewed. | | |
| INFO-02 | P1 | Read /privacy for the section Photos you tag us in. | The section explains that tagged public Instagram photos may be shown on the Community page with the username and a link, and that a photo can be taken down on request. It is marked as a draft for the owner to confirm. | | |
| INFO-03 | P1 | Open /returns. | A draft notice shows. The page says conditions do not limit the customer's rights under South African law. Contact details show. | | |
| INFO-04 | P1 | Open /delivery. | A draft notice shows. Any detail the owner has not supplied reads To be confirmed. | | |
| INFO-05 | P1 | Open /size-guide. | A draft notice shows. Details not supplied read To be confirmed. | | |
| INFO-06 | P2 | Open /about and /customer-service. | Pages load with the contact details (email and WhatsApp number) from the shop settings. | | |
| INFO-07 | P2 | Compare the delivery times and prices on /delivery with the admin Delivery section. | They do not contradict each other. Report any difference. | | |
| INFO-08 | P1 | Search every help and legal page for the old Terms page. | There is no Terms page link. The terms were removed on purpose until someone qualified confirms them. | | |
| INFO-09 | P2 | Press the contact links (email and WhatsApp) on /customer-service. | They open the mail app and WhatsApp with the shop's details. | | |

### 3.16 Link previews on WhatsApp and Instagram (PREV)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| PREV-01 | P1 | Copy a product page link from the Preview. Paste it into a WhatsApp chat (do not send to a customer; use a chat with yourself). Wait a few seconds. | A preview card shows the product name, a description and the product image. | | |
| PREV-02 | P2 | Do the same with a product that has no photo. | The preview uses the default brand image (a placeholder until the owner replaces it). | | |
| PREV-03 | P2 | Paste an event link into WhatsApp. | The preview shows the event title and image. | | |
| PREV-04 | P2 | Paste the home page link into WhatsApp. | A preview with the shop name and description shows. | | |
| PREV-05 | P3 | Send the product link in an Instagram direct message to yourself. | A card or link shows. (Instagram previews are less reliable than WhatsApp.) | | |
| PREV-06 | P2 | Paste a link to /admin into WhatsApp. | No private details show. | | |
| PREV-07 | P3 | If a preview looks stale, change the end of the link (add ?x=1) and paste again. | A fresh preview appears. (WhatsApp keeps old previews for a while.) | | |

### 3.17 Phone layout (PHONE)

Use a real phone, or the browser's device mode at a narrow width.

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| PHONE-01 | P1 | Open the home page on a phone. | Everything fits the screen. You do not need to scroll sideways. Text is readable without zooming. | | |
| PHONE-02 | P1 | Open the header menu on the phone. | Menu links open and close cleanly. The cart count shows. | | |
| PHONE-03 | P1 | On the phone, go from product to cart to checkout and place a test order. | Every step is usable with one thumb. Buttons are large enough to press. | | |
| PHONE-04 | P2 | Use the filters on /shop on a phone. | Dropdowns open as the phone's own pickers and filtering works. | | |
| PHONE-05 | P2 | Open /events, an event, and a ticket on the phone. | All fit the screen. The QR code is big enough to scan. | | |
| PHONE-06 | P2 | Open /admin on the phone and move between sections. | The section list works and tables can be read or scrolled. | | |
| PHONE-07 | P2 | Turn the phone sideways. | The pages still look right. | | |
| PHONE-08 | P2 | Fill in checkout with the phone keyboard. | The phone shows a number keyboard for phone and postal code where it makes sense. Fields are not hidden behind the keyboard. | | |

### 3.18 Accessibility and reduced motion (A11Y)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| A11Y-01 | P2 | On a computer, use only the Tab key to move through the home page and the shop. | Each link and button gets a clear visible outline, in a sensible order. | | |
| A11Y-02 | P2 | Use only the keyboard to add a product to the cart (Tab, Enter and space). | You can pick a size and colour and add to cart without the mouse. | | |
| A11Y-03 | P2 | Use only the keyboard to fill in and submit checkout. | Every field and button works. Error messages show next to the fields. | | |
| A11Y-04 | P2 | Turn on "Reduce motion" in your device settings (Windows: Show animations off; Mac: Reduce motion; iPhone: Reduce Motion). Reload the shop. | Animations and slide effects are removed or much calmer. Nothing is stuck. | | |
| A11Y-05 | P2 | Zoom the browser to 200 percent. | Pages still work and nothing is cut off. | | |
| A11Y-06 | P3 | Look at images. Hover over product photos or have a screen reader read them. | Images have descriptions (alt text) rather than file names. | | |
| A11Y-07 | P3 | Check text contrast in light and dark mode. | Body text is easy to read in both. | | |

### 3.19 Admin sign-in and access (AUTH)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| AUTH-01 | P1 | In a private window, open /admin. | A sign-in form with Email and Password. No admin data shows. | | |
| AUTH-02 | P1 | Enter a wrong password for the admin email. | A sign-in error shows. You are not let in. | | |
| AUTH-03 | P1 | Sign in with the admin email and password. | The page shows Admin Panel with the sections: Dashboard, Orders, New order, Customers, Products, Categories, Delivery, Discounts, Events, Door and Community. | | |
| AUTH-04 | P1 | Reload the page. | You stay signed in. | | |
| AUTH-05 | P1 | Press Sign out. | You return to the sign-in form. Pressing Back does not show admin data. | | |
| AUTH-06 | P1 | Find the admin link from the public site. | The only link is Staff sign in in the footer. No admin link in the header, home or other pages. | | |
| AUTH-07 | P1 | Sign in with an account that exists but is not an admin (ask the developer for one, or skip if none exists). | The page says This account doesn't have admin access. No admin data or buttons appear. | | |
| AUTH-08 | P1 | Ask the developer to confirm in the Supabase dashboard: Authentication, Sign In / Providers, Allow new users to sign up is OFF. Or try to create an account from the sign-in form. | There is no sign-up button. New accounts cannot be created by visitors. | | |
| AUTH-09 | P1 | Open a section directly, for example /admin?section=orders, while signed out. | The sign-in form shows first. After signing in the Orders section opens. | | |
| AUTH-10 | P1 | Open each section once: the 11 sections in AUTH-03. | Each loads its data. None shows an error or stays on Loading. Do this first on the new sections: Delivery, Customers, Discounts and Community. | | |
| AUTH-11 | P2 | In the browser, open the page source of /admin while signed out. | No order, customer or product data appears in the source. | | |

### 3.20 Admin: Dashboard (ADM-DASH)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| ADM-DASH-01 | P2 | Open Dashboard with a paid test order in the system. | Orders to pack lists it. With none, it says Nothing to pack right now. | | |
| ADM-DASH-02 | P2 | Place a test order and leave it unpaid. Open Dashboard. | A box shows Unpaid, expiring within 12 hours with those orders. With none, it says No unpaid order is about to expire. | | |
| ADM-DASH-03 | P2 | Check the refund and low stock boxes. | A box shows orders with Refund due or an amount mismatch (or says no payment needs a check). Low stock products are listed (or the page says every active product has enough stock). | | |

### 3.21 Admin: Orders (ADM-ORD)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| ADM-ORD-01 | P1 | Open Orders. | A table of orders with Customer, Date, Items, Total, Status, Expires and Actions. Filter buttons All, To pack, Packed, Shipped, Pending and Finished show counts. | | |
| ADM-ORD-02 | P1 | Press Pending. | Only unpaid orders show, including your TEST ORDER. | | |
| ADM-ORD-03 | P1 | Press Mark paid on a test order. Confirm the question. | A message says Marked (reference) paid. The status becomes Paid. The Expires date is gone. | | |
| ADM-ORD-04 | P1 | On a different pending test order, press Extend 48h. | The Expires time moves forward by 48 hours. | | |
| ADM-ORD-05 | P1 | On a paid order, press Mark packed, then Mark shipped, then Mark delivered. | Each press moves the status to Packed, Shipped and Delivered. The order moves between the filters. | | |
| ADM-ORD-06 | P1 | Note the stock of one ordered size and colour in Products. Cancel the matching pending test order (Cancel order, confirm: its stock will be returned). | A Cancelled message shows. The stock count goes back up by the ordered quantity. | | |
| ADM-ORD-07 | P2 | Open Cancelled orders in the Finished filter. | The cancelled order shows as Cancelled. A paid order that is cancelled shows Refund due and offers Refund. | | |
| ADM-ORD-08 | P2 | On an order marked as refund due, press Refund and confirm. | The status becomes Refunded. The stock is not returned a second time. (Test only if you have such an order. Skip otherwise.) | | |
| ADM-ORD-09 | P1 | On a shipped or paid order, enter courier, tracking number and an https:// tracking link and press Save tracking. | Saved. The customer's order page shows the tracking number and link. | | |
| ADM-ORD-10 | P2 | Enter a tracking link that does not start with https:// and save. | A message says the tracking link has to start with https://. | | |
| ADM-ORD-11 | P2 | Press Message on WhatsApp on an order. | WhatsApp opens a chat with that customer's number and a prepared message. | | |
| ADM-ORD-12 | P1 | Press the packing list button in Orders to open the Packing list. | A page titled Packing list shows how many paid orders there are, each with customer, delivery and items. If none are paid it says Nothing to pack: no paid orders. | | |
| ADM-ORD-13 | P1 | Press Print on the packing list (or use Save as PDF in the print window). | The print preview shows only the packing list: no site header, footer or buttons. Text is readable and fits the paper. Test this on a real printer if you can. | | |
| ADM-ORD-14 | P2 | Press Refresh and Back to orders on the packing list. | The list reloads, and Back returns to the orders table. | | |
| ADM-ORD-15 | P2 | Confirm that a test order older than 48 hours and unpaid has turned to Expired with its stock returned. | The status says Expired. Stock is back. (Only if time allows; the clean-up job runs every 5 minutes.) | | |

### 3.22 Admin: New order and payment link (ADM-NEW)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| ADM-NEW-01 | P1 | Open New order. Choose products, sizes, colours and quantities. | Lines show. The page says the server sets the final prices and delivery fee. | | |
| ADM-NEW-02 | P1 | Enter TEST ORDER as the name and your phone, choose a delivery option and fill in the address. | Required fields are accepted. Missing ones are highlighted with a Check the highlighted fields message. | | |
| ADM-NEW-03 | P1 | Choose how the customer pays: Customer pays on WhatsApp or cash. Create the order. | An Order created page shows the reference and the order link. The order is in Orders as pending, with stock taken. | | |
| ADM-NEW-04 | P1 | Press Copy order link. | A message says Order link copied. Pasting it gives the link to that order. | | |
| ADM-NEW-05 | P1 | Press Send on WhatsApp on the Order created page. | WhatsApp opens to the customer's number with the order link message. | | |
| ADM-NEW-06 | P2 | Create an order where the customer pays by link (Send payment link). | The order is created and held for 48 hours. (Paying through the link only works once Paystack is on.) | | |
| ADM-NEW-07 | P2 | Enter a phone number that cannot be used for WhatsApp. | A message says that phone number can't be used for WhatsApp. | | |
| ADM-NEW-08 | P2 | Try to add a line quantity above the allowed limit. | A message says up to a set number of one item and to split it over two orders. | | |
| ADM-NEW-09 | P2 | Add an item, enter TESTCODE10 under Discount code and press Apply. | The discount shows and the estimated total drops. | | |
| ADM-NEW-10 | P2 | Create the order with the code applied. | Order created shows the discount, and the total matches admin Orders. | | |
| ADM-NEW-11 | P2 | Apply a code, then change a quantity. | The code shows Check your code again and is not sent with the order until applied again. | | |
| ADM-NEW-12 | P3 | Enter a made-up code and press Apply, then press Enter in the field. | The server's refusal shows. Enter does not create the order. | | |

### 3.23 Admin: Products, images and stock grid (ADM-PROD)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| ADM-PROD-01 | P1 | Open Products. | A list of all products with prices and stock. | | |
| ADM-PROD-02 | P1 | Press Add Product. Enter name TEST PRODUCT, a price, a category, a size and a colour and save. | A message says it is added. It shows in the list and in the shop. | | |
| ADM-PROD-03 | P1 | In the product form, upload a real photo (JPEG, PNG, WebP or GIF, under 2MB). | The upload works and a preview of the photo shows. After saving, the photo shows on the shop and the product page. This has not been confirmed live before. | | |
| ADM-PROD-04 | P1 | Try to upload a file over 2MB, and then a file that is not an image (for example a PDF). | A message says the image size should be less than 2MB, or that it must be a JPEG, PNG, WebP or GIF. Nothing uploads. | | |
| ADM-PROD-05 | P1 | Open the stock grid (Stock by size and colour). Change the stock of one size and colour and save. | The stock changes. The shop's size buttons for that colour reflect it (a size set to 0 is disabled). | | |
| ADM-PROD-06 | P1 | Check the Total in the stock grid. | It is the sum of the per-size numbers. | | |
| ADM-PROD-07 | P2 | Edit TEST PRODUCT's price and save. Reload the shop and the product page. | The new price shows everywhere. | | |
| ADM-PROD-08 | P2 | Switch TEST PRODUCT to inactive (if the form has an active tick box). | It disappears from the shop for visitors but stays in admin. | | |
| ADM-PROD-09 | P2 | Edit a product in two browser tabs. Save in one, then try to save a stock change in the other. | The second save is refused with a message that the stock changed and to reload. (The stock is not overwritten.) | | |
| ADM-PROD-10 | P1 | Delete TEST PRODUCT (confirm). | It is removed from admin and the shop. | | |
| ADM-PROD-11 | P2 | Note: the live stock per size was split evenly from each product's total. Count a few real items. | Real counts are entered in the grid before launch. Mark Pass when the owner has done this. | | |

### 3.24 Admin: Categories (ADM-CAT)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| ADM-CAT-01 | P1 | Open Categories. Add a category named TEST CATEGORY. | A message says it is added. It shows in the list and in the shop's Category dropdown. | | |
| ADM-CAT-02 | P2 | Add TEST CATEGORY again. | A message says that category already exists. | | |
| ADM-CAT-03 | P2 | Try to add a category with no name. | A message says the category name is required. | | |
| ADM-CAT-04 | P2 | Edit TEST CATEGORY's name and save. | A message says it is saved and the new name shows in the shop. | | |
| ADM-CAT-05 | P2 | Try to delete a category that has products. | A message says the category is in use. It is not deleted. | | |
| ADM-CAT-06 | P1 | Delete TEST CATEGORY (confirm). | It is gone from admin and the shop. | | |

### 3.25 Admin: Events and tickets (ADM-EVT)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| ADM-EVT-01 | P1 | Open Events. Create a new event named TEST EVENT with a future date in South African time, a place and a free ticket type with a small number of tickets. Save it as Draft. | The event is saved. It does not show on /events. | | |
| ADM-EVT-02 | P1 | Change its status to Published (on the website) and save. | It shows on /events with the right date and time. | | |
| ADM-EVT-03 | P1 | RSVP to TEST EVENT on the website (see EVT-03). Open its Tickets in admin. | The ticket shows with the holder name, code and status. | | |
| ADM-EVT-04 | P1 | In the issue-tickets form, add a paid ticket type to the event, then issue 2 tickets for TEST ORDER with a phone number. | A message says Issued 2 tickets and a link for each. The message says to send each link to the holder. | | |
| ADM-EVT-05 | P1 | Press the copy button on an issued ticket. | A message says Link copied. Pasting it opens the ticket page. | | |
| ADM-EVT-06 | P1 | Void a ticket (confirm: the seat goes back on sale). | A message says Ticket voided. Its ticket page says the ticket was cancelled and will not be accepted. | | |
| ADM-EVT-07 | P2 | Try to void a ticket that was already checked in. | A message says that ticket was already used at the door. | | |
| ADM-EVT-08 | P2 | Try to issue tickets with quantity 0 or 21, with no name, or with a short phone number. | Each is refused with its own message. | | |
| ADM-EVT-09 | P2 | Try to delete TEST EVENT while tickets exist. | A message says tickets were issued and to set the event to Cancelled instead. | | |
| ADM-EVT-10 | P2 | Set TEST EVENT to Cancelled. | It leaves /events. The tickets remain in admin. | | |
| ADM-EVT-11 | P3 | After the events test, delete an unused event (confirm). | It is removed. | | |

### 3.26 Admin: Door (ADM-DOOR)

The real-phone door test is in section 3.12. These check the admin screen itself.

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| ADM-DOOR-01 | P1 | Open Door with no events (use a fresh state) or with events. | Without events it says No events yet. With events, you are asked to choose the event you are checking people in to. | | |
| ADM-DOOR-02 | P1 | Choose TEST EVENT. | The list downloads and the event's counts (checked in vs total) show. | | |
| ADM-DOOR-03 | P2 | Check in a ticket by typing its code. Then look at the event's Tickets list. | The ticket shows as checked in with a time. | | |

### 3.27 Admin: Community, gallery and fit wall panel (ADM-COM)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| ADM-COM-01 | P1 | Open Community. | Sections show: Gallery, Subscribers, Your fit wall, Restock requests and (when email is on) Send to the list. | | |
| ADM-COM-02 | P1 | In Gallery, add a photo with a caption (JPEG, PNG, WebP or GIF, up to 2MB). | A message says Photo added. It shows in the admin list and on /community. | | |
| ADM-COM-03 | P2 | Change the order number of a photo (lowest first) and save. Reload /community. | The gallery order changes. | | |
| ADM-COM-04 | P2 | Hide the photo with its Hide button. | A message says Photo hidden. It leaves /community. Press Show to bring it back. | | |
| ADM-COM-05 | P2 | Try to upload a file over 2MB or a PDF. | A message about the size or type. Nothing uploads. | | |
| ADM-COM-06 | P1 | Delete the test photo (confirm). | A message says Photo deleted. It is gone from /community. | | |
| ADM-COM-07 | P1 | In Subscribers, search for TEST ORDER. | Your test subscriber shows. A search with no match says No subscribers match. | | |
| ADM-COM-08 | P2 | Press Export CSV. | A file downloads with the list. Open it: names and contacts show in columns. | | |
| ADM-COM-09 | P1 | Opt out a test subscriber in admin (confirm). | A message says Opted out. The status updates. | | |
| ADM-COM-10 | P1 | Look at the Your fit wall panel while Instagram is not connected. | It says Instagram isn't connected yet and that the wall shows placeholder tiles until it is. | | |
| ADM-COM-11 | P2 | Look at Restock requests when none are pending. | It says Nobody is waiting for a restock. | | |
| ADM-COM-12 | P2 | Look at the Send to the list area while email is off. | A message says Email is off and that it switches on once the email account is set up. | | |

### 3.28 Admin: Customers (ADM-CUS)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| ADM-CUS-01 | P1 | Open Customers after placing test orders. | A list of customers built from orders. TEST ORDER shows with the number of orders and total spent. | | |
| ADM-CUS-02 | P2 | Search by name, phone or email. | The list narrows. A search with no match says No customers match. | | |
| ADM-CUS-03 | P2 | Look for a marker showing whether the customer is on the mailing list (On the list). | It is shown correctly for the customers who signed up. | | |
| ADM-CUS-04 | P2 | Press Message on WhatsApp on a customer. | WhatsApp opens to that customer's number. | | |

### 3.29 Admin: Delivery rates (ADM-DLV)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| ADM-DLV-01 | P1 | Open Delivery. | The delivery options show with their names and prices in R. | | |
| ADM-DLV-02 | P1 | Change a price and save. | A message says Saved with the option's name. The new price shows at checkout. | | |
| ADM-DLV-03 | P2 | Clear the name and try to save. | A message asks you to enter a delivery name. | | |
| ADM-DLV-04 | P2 | Enter a negative or very large price. | The save is refused with a message. | | |
| ADM-DLV-05 | P1 | Set the real rates the owner wants. | The numbers match what the owner decided. Mark Pass once done. (The live placeholders are door R85, locker R55, collect R0.) | | |

### 3.30 Admin: Discounts (ADM-DSC)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| ADM-DSC-01 | P1 | Open Discounts. | A table of codes, or No discount codes yet. A line says codes can't be deleted and to turn one off to stop it working. | | |
| ADM-DSC-02 | P1 | Add a code TESTCODE10, type Percent off, amount 10. Press Add code. | A message says Added TESTCODE10. It shows in the list. | | |
| ADM-DSC-03 | P1 | Add a Rand off code (for example TESTR50, amount 50) with a minimum spend of R300, an expiry in the future and a use limit of 1. | It is added and shows its limits. | | |
| ADM-DSC-04 | P2 | Add a code with the same name as an existing one. | The existing code is not duplicated (it either updates or shows an error). | | |
| ADM-DSC-05 | P2 | Enter an amount of 0 or over 100 percent. | A validation message appears and nothing is saved. | | |
| ADM-DSC-06 | P1 | Untick On for TESTCODE10 so it is off. Try it at checkout. | It saves right away. At checkout the code is rejected as not valid. | | |
| ADM-DSC-07 | P2 | Look at a code that has passed its expiry. | It shows as Expired. | | |
| ADM-DSC-08 | P2 | Look at the uses column after a test order with a code. | The used count went up by one. After cancelling that order it goes back down. | | |

### 3.31 Cross-area checks (X)

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| X-01 | P1 | Place a full TEST ORDER start to finish: shop, product, cart, checkout, WhatsApp, admin Mark paid, Packed, Shipped with tracking, and the customer view. | Every screen agreed on the reference, lines and total. The customer's status page and tracking matched admin. | | |
| X-02 | P1 | Place a TEST ORDER, then cancel it in admin and check Products stock. | The stock returned exactly once. | | |
| X-03 | P2 | Look at admin and the shop after all tests. | No leftover test products, categories or events are visible to visitors. (Clean up first.) | | |

## 4. Only after setup

Run these sections only when the owner has set the accounts up. Until then, mark every test Blocked with the note "Not set up yet". Never put keys in a chat, in a screenshot or in this document.

### 4.1 Paystack online payment (PAY)

**What must be set first:**

1. A Paystack account for the business, verified, taking ZAR.
2. The Paystack test key (it starts sk_test_) stored as the PAYSTACK_SECRET_KEY secret in Supabase, by the person who holds the keys.
3. The webhook address entered in Paystack's dashboard (the developer has it).
4. **verify_jwt switched off first.** The server function currently refuses calls with no Supabase token, so Paystack's calls would be blocked. The developer must set verify_jwt to false for the function and redeploy before any payment is tested.

**How to confirm it is on:** at checkout, a Pay online choice appears, and /order pages for unpaid orders show Pay now. While off, neither shows.

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| PAY-01 | P1 | At checkout, look for Pay online. | Pay online shows. A note says an email is needed. It shows card or bank on a secure page. | | |
| PAY-02 | P1 | Choose Pay online without an email and try to place the order. | A message says Email is needed to pay online. | | |
| PAY-03 | P1 | Enter TEST ORDER, your own email and a phone. Choose Pay online. Press Place order and pay. | The order is saved, then you are taken to the Paystack page (the page says Taking you to the payment page). | | |
| PAY-04 | P1 | On the Paystack page, use a Paystack sandbox test card shown in Paystack's own test documentation. Complete the payment. | You return to the shop and see Confirming your payment, then the order shows Paid. | | |
| PAY-05 | P1 | In admin Orders, open the same order. | The status is Paid, the Expires date is gone and the amount matches. | | |
| PAY-06 | P1 | Cancel a payment halfway (close the Paystack page). Open /order for that order. | The order awaits payment and shows Pay now. | | |
| PAY-07 | P1 | Press Pay now on that order and pay with the test card. | The order becomes Paid. | | |
| PAY-08 | P2 | Leave an online order unpaid for over 30 minutes. | It becomes cancelled and expired. Stock returns. | | |
| PAY-09 | P1 | Check the Paystack key is the TEST key. | Payments are in sandbox. No real money moves. After these pass, the owner switches to the live key and does one real small payment, then refunds it. | | |
| PAY-10 | P2 | In Dashboard, look for Refund due or an amount mismatch. | Nothing is wrongly listed after a clean payment. | | |

### 4.2 Email and sending to the list (MAIL)

**What must be set first:** a Resend account, a verified sending domain, and three secrets: RESEND_API_KEY, EMAIL_FROM and SITE_URL (the live address, no trailing slash). Email needs both RESEND_API_KEY and EMAIL_FROM. The Send to the list screen needs all three.

**How to confirm it is on:** in admin Community, the Send to the list area shows its form (Subject, Message, Send a test to). While off, it says Email is off.

Use your own email address only. Do not email the real list during testing. The first real send should be small.

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| MAIL-01 | P1 | Place a test order with your own email address. | Within a minute an email arrives saying the order is received, in plain text, with a link to view the order. | | |
| MAIL-02 | P1 | Mark that order paid in admin. | An email arrives saying payment is received. | | |
| MAIL-03 | P1 | Mark it shipped. | An email arrives saying it has shipped. | | |
| MAIL-04 | P1 | Place an order without an email address. | The order works. No email is sent and no error shows. | | |
| MAIL-05 | P2 | Check the email links. | They open the real site's order page, not localhost or the Preview address (unless SITE_URL is set to it). | | |
| MAIL-06 | P2 | Check the emails are not in spam, and that the sender is the shop. | The sender is the shop's address and the mail arrives in the inbox. | | |
| MAIL-07 | P1 | In admin Community, open Send to the list. Write a short subject and message. Send a test to your own email. | The test arrives. It has an unsubscribe line at the end. | | |
| MAIL-08 | P1 | Press the unsubscribe link in the test. | It opens the unsubscribe page for your address. | | |
| MAIL-09 | P2 | Subscribe only test contacts first (your own email). Send to the list and confirm the question (it says how many people). | Only people with an email receive it. A message says it finished. Keep the page open until it finishes. | | |
| MAIL-10 | P3 | Stop a send midway (close the page) and reopen. | A Continue button picks up the rest. Nobody is emailed twice. | | |
| MAIL-11 | P2 | Check the day's sending limit in Resend against the size of the list. | The limit is higher than the list. | | |

### 4.3 Instagram fit wall (FIT)

**What must be set first:** the shop's Instagram account as a Business or Creator account linked to a Facebook Page; a Meta developer app with the Instagram Graph API; a token with the permissions listed in the owner handover; the Instagram user id. Both secrets must be set: INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID.

**How to confirm it is on:** in admin Community, the Your fit wall panel no longer says Instagram isn't connected yet, and Check Instagram now works. While off, the wall shows placeholder tiles. This has not been tested against the real Instagram yet.

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| FIT-01 | P1 | From a personal account, post a public photo tagging the shop's Instagram account. | The post is live on Instagram. | | |
| FIT-02 | P1 | In admin Community, Your fit wall, press Check Instagram now. | The photo shows under On the wall in admin. | | |
| FIT-03 | P1 | Open /community. | The photo shows on Your fit, here with the poster's @username and a link to the post. | | |
| FIT-04 | P1 | Tag the shop in a second photo and press Check Instagram now again. | The newest photo comes first. This also checks that the order is right: Instagram may not return newest first, so the shop sorts it itself. | | |
| FIT-05 | P2 | Tag the shop in 7 or more photos in total. | The wall shows at most 6. The other tiles are empty slots (placeholders). | | |
| FIT-06 | P1 | In admin, press Hide on a photo (confirm Hide this photo from the site?). | The photo leaves /community at once and shows under Hidden. | | |
| FIT-07 | P1 | Press Show again on the hidden photo, then press Check Instagram now. | The photo can return to the wall. | | |
| FIT-08 | P2 | Post a video or reel tagging the shop. | It is skipped and never shows on the wall. | | |
| FIT-09 | P2 | Remove the tag or delete the post on Instagram. Wait for the next check (up to 15 minutes, or press Check Instagram now). | The photo leaves the wall. | | |
| FIT-10 | P2 | Look at the panel after Instagram stops answering (an expired token). | A message says Instagram didn't answer on the last check, the wall hasn't changed, and the token may have expired. The wall still shows the last photos. | | |
| FIT-11 | P3 | Visit /community several times in a few minutes. | The page stays fast and does not call Instagram on each visit. | | |

## 5. After sample data removal

Do this after the developer runs the sample data removal (docs/demo-data). The removal deletes the sample products, events and gallery items and takes the owner's five products back to having no photos. It stops without changing anything if a real order includes a sample product.

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| POST-01 | P1 | Open /shop. | Only the owner's real products show (the original five). No sample names. | | |
| POST-02 | P1 | Open /events. | Only real events show. No sample events. Any RSVP made to a sample event is gone. | | |
| POST-03 | P1 | Open /community. | No sample gallery photos. Placeholder or real photos only. | | |
| POST-04 | P1 | Open each product. | Photos are missing until the owner uploads real ones. The page shows No photo, not a broken image. | | |
| POST-05 | P1 | In admin, upload real photos and check real prices and stock counts. | The shop shows them. The prices match what the owner wants. | | |
| POST-06 | P2 | Search the whole site for any Unsplash photos or sample names. | None remain. | | |
| POST-07 | P1 | In admin Products, categories and Delivery, check the lists. | Only real categories, delivery options and rates remain. | | |

## 6. Short smoke test on the real domain after launch

Run this within an hour of going live. It should take about 15 minutes. Use one real, small order only if the owner agrees, and cancel or fulfil it.

| ID | Priority | Steps | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|---|
| LIVE-01 | P1 | Open the real domain on a computer and a phone. | Home page loads in the shop's look. | | |
| LIVE-02 | P1 | Open /shop, a product, add to cart and open /cart. | All work with real prices. | | |
| LIVE-03 | P1 | Place a TEST ORDER and send it on WhatsApp. | The reference and total are right. The WhatsApp message opens. | | |
| LIVE-04 | P1 | In admin, find the order, then cancel it. | It shows, and cancelling returns the stock. | | |
| LIVE-05 | P1 | Paste a product link into WhatsApp. | The preview shows the name, description and image from the real domain. | | |
| LIVE-06 | P1 | Run the security headers check on the real domain. | The same four headers as DEP-08. | | |
| LIVE-07 | P1 | Visit /admin signed out. | The sign-in form only. | | |
| LIVE-08 | P2 | Open /community and /events. | They load with real content. | | |
| LIVE-09 | P2 | Check the search engine marking (view page source, search for robots). | It matches the owner's decision (noindex for now, or open to search once changed). | | |
| LIVE-10 | P1 | Clean up the LIVE-03 order. | No test order remains pending. | | |

## 7. Clean up after testing

The Preview uses the live database, so test rows are real. Do all of these, then tick the box.

| Done | What to clean up | How |
|---|---|---|
| [ ] | Test orders | Admin, Orders. Find every order named TEST ORDER (look under Pending, Paid and the rest). Press Cancel order and confirm. Stock returns. For a paid test order, cancel it, and if it shows Refund due and no real money was paid, press Refund only if the order was a sandbox payment. Check Products stock afterwards to make sure it went back to what it was. |
| [ ] | Orders that are packed, shipped or delivered | If the admin offers no Cancel order button for them, tell the developer to remove them. Note their references here: ____________ |
| [ ] | Test tickets | Admin, Events, open the event, Tickets. Press Void on every ticket named TEST ORDER. The seats go back on sale. |
| [ ] | Test events | Set TEST EVENT to Cancelled (events with tickets cannot be deleted). Delete test events that have no tickets. |
| [ ] | Test subscribers | Admin, Community, Subscribers. Opt out every TEST ORDER entry. (The row stays as the consent record. This is normal.) |
| [ ] | Test restock requests | Admin, Community, Restock requests. Press Mark as told (or remove) on each. |
| [ ] | Test discount codes | Admin, Discounts. Untick On for every test code (TESTCODE10 and the others). Codes cannot be deleted. They stay in the list, off. |
| [ ] | Test fit photos | Admin, Community, Your fit wall. Press Hide on any test photo from the Instagram tests. |
| [ ] | Test gallery photos, products, categories | Delete anything named TEST in Gallery, Products and Categories. |
| [ ] | Changed rates or settings | Put back any delivery price or option you changed during DEL-07 and DEL-08, unless the owner chose new real rates. |
| [ ] | Browser | Sign out of /admin on every device used. Clear the cart. Turn off any airplane mode. |
| [ ] | Paystack and email | Sandbox payments leave no live money. Delete or ignore test emails. |

## 8. Sign-off

Fill in one row per area when every test in it has a result. Result is Pass (all P1 passed), Pass with notes (all P1 passed but P2 or P3 failed) or Fail (a P1 failed or is Blocked).

| Area | Tester | Date | Result |
|---|---|---|---|
| Deployment and basics | | | |
| Home | | | |
| Light and dark mode | | | |
| Shop and filters | | | |
| Product page | | | |
| Cart and stock limits | | | |
| Checkout with WhatsApp | | | |
| Delivery options | | | |
| Discount codes at checkout | | | |
| Order status and tracking | | | |
| Events, RSVP and tickets | | | |
| Door check-in on a real phone | | | |
| Community page and fit wall placeholders | | | |
| Mailing list, unsubscribe, restock | | | |
| Help and legal pages | | | |
| Link previews | | | |
| Phone layout | | | |
| Accessibility and reduced motion | | | |
| Admin sign-in and access | | | |
| Admin: Dashboard | | | |
| Admin: Orders | | | |
| Admin: New order and payment link | | | |
| Admin: Products, images and stock grid | | | |
| Admin: Categories | | | |
| Admin: Events and tickets | | | |
| Admin: Door | | | |
| Admin: Community, gallery and fit wall | | | |
| Admin: Customers | | | |
| Admin: Delivery rates | | | |
| Admin: Discounts | | | |
| Only after setup: Paystack | | | |
| Only after setup: Email and list sending | | | |
| Only after setup: Instagram fit wall | | | |
| After sample data removal | | | |
| Post-launch smoke test | | | |
| Clean up done | | | |

**Launch decision:** all P1 tests passed? Yes / No. Signed by: ____________  Date: ____________
