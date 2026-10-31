import type { Route } from "./+types/checkout";
import { Checkout } from "../components/Checkout";
import { originFromMatches, pageMeta } from "../lib/seo";

export const meta: Route.MetaFunction = ({ matches, location }) =>
  pageMeta({
    origin: originFromMatches(matches),
    title: "Checkout | 4Nguru",
    description: "Check out your 4Nguru order.",
    path: location.pathname,
    noindex: true,
  });

export default function CheckoutRoute() {
  return <Checkout />;
}
