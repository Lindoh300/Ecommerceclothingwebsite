import { index, route, type RouteConfig } from "@react-router/dev/routes";
import { LEGACY_CATEGORY_IDS } from "./utils/categoryPath";

// Same URLs as before. Route modules are thin wrappers in routes/ around the components.
// Legacy category paths (/tshirts etc.) keep working; their ids live in utils/categoryPath.ts,
// which the nav also uses. Every other category is served by category/:id.
export default [
  index("routes/home.tsx"),
  ...LEGACY_CATEGORY_IDS.map((id) => route(id, "routes/category-legacy.tsx", { id: `category-${id}` })),
  route("shop", "routes/shop.tsx"),
  route("category/:id", "routes/category.tsx"),
  route("product/:id", "routes/product.tsx"),
  route("events", "routes/events.tsx"),
  route("community", "routes/community.tsx"),
  route("event/:slug", "routes/event.tsx"),
  route("ticket/:code", "routes/ticket.tsx"),
  route("cart", "routes/cart.tsx"),
  route("checkout", "routes/checkout.tsx"),
  route("order/:id", "routes/order.tsx"),
  route("track", "routes/track.tsx"),
  route("admin", "routes/admin.tsx"),
  route("about", "routes/about.tsx"),
  route("customer-service", "routes/customer-service.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("unsubscribe", "routes/unsubscribe.tsx"),
  route("returns", "routes/returns.tsx"),
  route("delivery", "routes/delivery.tsx"),
  route("size-guide", "routes/size-guide.tsx"),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
