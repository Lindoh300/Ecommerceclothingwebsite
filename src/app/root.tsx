import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { Route } from "./+types/root";
import { theme, isGallery } from "./config/theme";
import { MODE_SCRIPT } from "./config/mode";
import { Root } from "./components/Root";
import { defaultMeta, originOf } from "./lib/seo";
import "../styles/index.css";

// The one thing the root loader gives every page: the site origin, for absolute URLs in link
// previews. It reads the request only. No API call, no product data.
export function loader({ request }: Route.LoaderArgs) {
  return { origin: originOf(request) };
}

export const meta: Route.MetaFunction = ({ data, location }) =>
  defaultMeta(data?.origin ?? "", location.pathname);

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme={theme} suppressHydrationWarning>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        {isGallery && <script dangerouslySetInnerHTML={{ __html: MODE_SCRIPT }} />}
        <style>{"html, body { height: 100%; margin: 0; }"}</style>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Root />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const heading = status === 404 ? "Page not found" : "Something went wrong";
  const message =
    status === 404
      ? "The page you're looking for doesn't exist."
      : "Please try again in a moment. If it keeps happening, message us on WhatsApp.";
  return (
    <main className="min-h-screen flex items-center justify-center bg-paper px-6 py-16">
      <div className="text-center">
        <p className="micro text-b60 mb-3">{status}</p>
        <h1 className="display h-mid mb-6">{heading}</h1>
        <p className="text-b60 mb-10">{message}</p>
        <Link to="/" className="cta">Go home</Link>
      </div>
    </main>
  );
}
