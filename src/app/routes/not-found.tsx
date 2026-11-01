import { data } from "react-router";
import { NotFound } from "../components/NotFound";

// Unknown URLs answer HTTP 404 (the catch-all route). The page itself is unchanged.
export function loader() {
  return data(null, { status: 404 });
}

export default function NotFoundRoute() {
  return <NotFound />;
}
