import type { Route } from "./+types/shop";
import { Shop } from "../components/Shop";
import { SITE_NAME, originFromMatches, pageMeta } from "../lib/seo";

// Filters live in the search params (?category=&size=&color=&stock=1&sort=), so a filtered link
// can be shared. No loader: products load in the browser. The canonical link is the bare /shop.
export const meta: Route.MetaFunction = ({ matches }) =>
  pageMeta({
    origin: originFromMatches(matches),
    title: `Shop | ${SITE_NAME}`,
    description: "Shop all 4Nguru clothing. Filter by category, size and colour, then order online or on WhatsApp.",
    path: "/shop",
    canonical: "/shop",
  });

export default function ShopRoute() {
  return <Shop />;
}
