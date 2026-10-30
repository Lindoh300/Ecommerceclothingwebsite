import { lazy, Suspense, useEffect, useState } from "react";
import { Outlet } from "react-router";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { GooFilters } from "./prism/GooFilters";

// The toaster (sonner) loads after hydration, so it is not part of the first-load JS.
const Toaster = lazy(() => import("./ui/sonner").then((m) => ({ default: m.Toaster })));

export function Root() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div className="min-h-screen flex flex-col">
      <GooFilters />
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
      {mounted && (
        <Suspense fallback={null}>
          <Toaster />
        </Suspense>
      )}
    </div>
  );
}
