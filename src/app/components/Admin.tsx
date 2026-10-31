import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Session } from "@supabase/supabase-js";
import { Lock } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { toast } from "../lib/toast";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { ApiError } from "../api/client";
import { AdminDashboard } from "./AdminDashboard";
import { AdminOrders } from "./AdminOrders";
import { AdminNewOrder } from "./AdminNewOrder";
import { AdminProducts } from "./AdminProducts";
import { AdminCategoriesSection } from "./AdminCategories";
import { AdminEvents } from "./AdminEvents";
import { AdminDoor } from "./AdminDoor";
import { AdminCommunity } from "./AdminCommunity";
import { SECTION_PARAM, sectionHref, type AdminSection } from "./adminSections";

/**
 * The admin sections, in nav order. To add one, import its component and add an entry here: the nav, the
 * `?section=` link and the page all come from this list. The first entry is the default. A section component
 * takes `AdminSectionProps` (see adminSections.ts).
 */
export const ADMIN_SECTIONS: AdminSection[] = [
  { id: "dashboard", label: "Dashboard", Component: AdminDashboard },
  { id: "orders", label: "Orders", Component: AdminOrders },
  { id: "new-order", label: "New order", Component: AdminNewOrder },
  { id: "products", label: "Products", Component: AdminProducts },
  { id: "categories", label: "Categories", Component: AdminCategoriesSection },
  { id: "events", label: "Events", Component: AdminEvents },
  { id: "door", label: "Door", Component: AdminDoor },
  { id: "community", label: "Community", Component: AdminCommunity },
];

// Local dev server: no Supabase, but an API base. Writes use the dev-admin token.
const devMode = !isSupabaseConfigured && !!import.meta.env.VITE_API_BASE;

function AdminNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center py-16 px-6">
      <div className="max-w-md w-full border border-b10 r-card p-8 md:p-10 text-center">
        <Lock className="w-6 h-6 text-ink mx-auto mb-6" />
        <h1 className="display h-mid mb-4">Admin</h1>
        {children}
      </div>
    </div>
  );
}

export function Admin() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(!!supabase);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled) setSession(data.session);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false);
      });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || signingIn) return;
    setSigningIn(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) toast.error(error.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setPassword("");
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) toast.error(error.message);
  };

  if (devMode) {
    return <AdminPanel />;
  }

  if (!isSupabaseConfigured) {
    return (
      <AdminNotice>
        <p className="text-b60">
          Admin isn't configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env (see
          docs/SUPABASE_SETUP.md).
        </p>
      </AdminNotice>
    );
  }

  if (authLoading) {
    return (
      <AdminNotice>
        <p className="text-b60">Loading…</p>
      </AdminNotice>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center py-16 px-6">
        <div className="max-w-md w-full border border-b10 r-card p-8 md:p-10">
          <div className="text-center mb-8">
            <Lock className="w-6 h-6 text-ink mx-auto mb-6" />
            <h1 className="display h-mid mb-4">Admin</h1>
            <p className="text-b60">Sign in to access the admin panel</p>
          </div>
          <form onSubmit={handleLogin}>
            <div className="mb-6">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter admin email"
                autoComplete="email"
                required
                autoFocus
              />
            </div>
            <div className="mb-6">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={signingIn}>
              {signingIn ? "Signing in…" : "Login"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // app_metadata can only be set server-side; user_metadata is user-editable and must not be used.
  if (session.user.app_metadata?.role !== "admin") {
    return (
      <AdminNotice>
        <p className="text-b60 mb-8">This account doesn't have admin access.</p>
        <Button onClick={handleSignOut} variant="outline">
          Sign out
        </Button>
      </AdminNotice>
    );
  }

  return (
    <AdminPanel
      email={session.user.email ?? ""}
      onSignOut={handleSignOut}
    />
  );
}

interface AdminPanelProps {
  email?: string;
  onSignOut?: () => void;
}

function AdminPanel({ email, onSignOut }: AdminPanelProps) {
  const [params] = useSearchParams();
  const current = ADMIN_SECTIONS.find((s) => s.id === params.get(SECTION_PARAM)) ?? ADMIN_SECTIONS[0];
  const activeTab = useRef<HTMLAnchorElement>(null);

  // On a phone the tab row scrolls on its own: keep the current tab in view after a reload or a link.
  useEffect(() => {
    activeTab.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [current.id]);

  const handleApiError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 401 && onSignOut) {
      toast.error("Session expired, please sign in again");
      onSignOut();
    } else if (err instanceof ApiError && err.status === 403) {
      toast.error("Not authorised");
    } else {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-[1968px] mx-auto px-4 md:px-6 py-8 md:py-16">
        {devMode && (
          <div className="border border-b10 px-4 py-3 mb-8 font-mono text-sm text-b60">
            Local dev mode: writes use the dev-admin token
          </div>
        )}
        {onSignOut && (
          <div className="flex flex-wrap justify-end items-center gap-4 mb-8">
            <span className="font-mono text-sm text-ink break-all">{email}</span>
            <Button onClick={onSignOut} variant="outline">
              Sign out
            </Button>
          </div>
        )}
        <div className="pb-8 md:pb-12 mb-6 border-b border-b10">
          <p className="micro text-b60 mb-6">Admin</p>
          <h1 className="display h-sec">Admin Panel</h1>
        </div>

        {/* The tab row scrolls sideways inside its own box, so the page itself never does. */}
        <nav aria-label="Admin sections" className="mb-8 md:mb-12">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {ADMIN_SECTIONS.map((s) => {
              const isCurrent = s.id === current.id;
              return (
                <Link
                  key={s.id}
                  to={sectionHref(s.id)}
                  ref={isCurrent ? activeTab : undefined}
                  aria-current={isCurrent ? "page" : undefined}
                  className={`micro shrink-0 whitespace-nowrap border r-card px-4 min-h-11 inline-flex items-center transition-colors ${
                    isCurrent ? "bg-ink text-paper border-ink" : "border-b10 text-ink hover:border-ink"
                  }`}
                >
                  {s.label}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* The key gives each section its own state, and loads its data afresh when it opens. */}
        <current.Component key={current.id} onApiError={handleApiError} />
      </div>
    </div>
  );
}
