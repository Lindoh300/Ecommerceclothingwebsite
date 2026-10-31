import type { ReactNode } from "react";

export function LoadState({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div className="py-16 text-center">
        <p className="micro text-b60">Loading…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="border border-b10 r-card p-12 text-center">
        <p className="text-b60 mb-6">{error}</p>
        <button type="button" onClick={onRetry} className="linkr text-ink mx-auto">
          Try again
        </button>
      </div>
    );
  }
  return <>{children}</>;
}
