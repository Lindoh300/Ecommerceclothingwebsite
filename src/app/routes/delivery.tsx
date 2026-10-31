import type { Route } from "./+types/delivery";
import { Delivery } from "../components/Delivery";
import { originFromMatches, pageMeta } from "../lib/seo";

export const meta: Route.MetaFunction = ({ matches, location }) =>
  pageMeta({
    origin: originFromMatches(matches),
    title: "Delivery | 4Nguru",
    description: "4Nguru delivery options: door delivery, locker delivery and collection. Fees are shown at checkout.",
    path: location.pathname,
    canonical: location.pathname,
  });

export default function DeliveryRoute() {
  return <Delivery />;
}
