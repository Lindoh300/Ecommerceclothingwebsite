import type { Route } from "./+types/ticket";
import { Ticket } from "../components/Ticket";
import { originFromMatches, pageMeta } from "../lib/seo";

// No loader: the ticket loads in the browser after mount, and the code in the URL is the capability, so the page
// is noindex and the head says nothing about the holder.
export const meta: Route.MetaFunction = ({ matches, location }) =>
  pageMeta({
    origin: originFromMatches(matches),
    title: "Your ticket | 4Nguru",
    description: "Your 4Nguru event ticket.",
    path: location.pathname,
    noindex: true,
  });

export default function TicketRoute() {
  return <Ticket />;
}
