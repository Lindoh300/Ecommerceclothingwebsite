import { data } from "react-router";
import type { Route } from "./+types/product";
import { ProductDetail } from "../components/ProductDetail";
import { getProduct } from "../api/products";
import { defaultMeta, originFromMatches, originOf, productMeta } from "../lib/seo";

// The only page with server data: the product for link previews and a first paint with the
// product on it. Everything else on the page loads in the browser as before.
//   found    -> product, 200
//   missing  -> no product, 404 (the page still renders "Product not found")
//   failed   -> no product, 200 (API down or not configured: the browser loads it as it does today)
const LOADER_TIMEOUT_MS = 4000;

// A slow API must not hold up the page: give up and let the browser load the product.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const origin = originOf(request);
  try {
    const product = params.id ? await withTimeout(getProduct(params.id), LOADER_TIMEOUT_MS) : null;
    if (product) return { origin, product, missing: false };
    return data({ origin, product: null, missing: true }, { status: 404 });
  } catch {
    return { origin, product: null, missing: false };
  }
}

export const meta: Route.MetaFunction = ({ data: loaderData, matches, location }) => {
  if (loaderData?.product) return productMeta(loaderData.origin, loaderData.product);
  const origin = loaderData?.origin ?? originFromMatches(matches);
  return defaultMeta(origin, location.pathname);
};

export default function ProductRoute({ loaderData }: Route.ComponentProps) {
  return <ProductDetail initialProduct={loaderData.product} notFound={loaderData.missing} />;
}
