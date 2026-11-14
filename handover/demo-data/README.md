# Removing the sample data

This removes the sample products, events and gallery items, and it must be done before real trading.

Run these steps from the repository root.

1. `supabase db query --linked -f handover/demo-data/remove.sql` deletes the demo gallery items, tickets, ticket types, events and products (variants cascade) and puts the images of products 1-5 back to the backup values. It refuses and changes nothing if any order has a line for a demo product.
2. Check the photos first with `supabase storage ls ss:///product-images/demo --linked --experimental`, then delete them with `supabase storage rm -r ss:///product-images/demo --linked --experimental`.

Photo credits are in `ATTRIBUTION.md`.
