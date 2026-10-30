import { lazy, Suspense, useEffect, useState } from "react";
import type { Route } from "./+types/admin";
import { originFromMatches, pageMeta } from "../lib/seo";

// Admin is never server-rendered with data. The server sends only the "Loading" notice below. The
// panel is a separate chunk, fetched in the browser after hydration, so lib/supabase and
// @supabase/supabase-js are neither imported on the server nor part of the customer bundles.
const Admin = lazy(() => import("../components/Admin").then((m) => ({ default: m.Admin })));

export const meta: Route.MetaFunction = ({ matches }) =>
  pageMeta({
    origin: originFromMatches(matches),
    title: "Admin | 4Nguru",
    description: "4Nguru store admin.",
    path: "/admin",
    noindex: true,
  });

function AdminLoading() {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center py-16 px-6">
      <p className="text-b60">Loading…</p>
    </div>
  );
}

export default function AdminRoute() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <AdminLoading />;
  return (
    <Suspense fallback={<AdminLoading />}>
      <Admin />
    </Suspense>
  );
}
