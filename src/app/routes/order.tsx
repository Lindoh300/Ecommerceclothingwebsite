import type { Route } from "./+types/order";
import { OrderStatus } from "../components/OrderStatus";
import { originFromMatches, pageMeta } from "../lib/seo";

export const meta: Route.MetaFunction = ({ matches, location }) =>
  pageMeta({
    origin: originFromMatches(matches),
    title: "Your order | 4Nguru",
    description: "Status of your 4Nguru order.",
    path: location.pathname,
    noindex: true,
  });

export default function OrderStatusRoute() {
  return <OrderStatus />;
}
