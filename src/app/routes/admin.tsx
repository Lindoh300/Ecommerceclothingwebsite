import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
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

// Catches a failed chunk load (stale deploy, lost signal) so the owner sees a message and a reload
// button instead of the root error screen. A full reload is needed because React.lazy caches a
// rejected import.
type AdminLoadBoundaryState = { failed: boolean };

class AdminLoadBoundary extends Component<{ children: ReactNode }, AdminLoadBoundaryState> {
  state: AdminLoadBoundaryState = { failed: false };

  static getDerivedStateFromError(): AdminLoadBoundaryState {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center py-16 px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-b60">The admin didn't load. Check your connection and try again.</p>
          <button type="button" className="cta" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

export default function AdminRoute() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <AdminLoading />;
  return (
    <AdminLoadBoundary>
      <Suspense fallback={<AdminLoading />}>
        <Admin />
      </Suspense>
    </AdminLoadBoundary>
  );
}
