import { useEffect, useMemo, useState } from "react";
import { toast } from "../lib/toast";
import { listRestockRequests, removeRestockRequest } from "../api/communityAdmin";
import type { RestockRequest } from "../api/types";
import { useAdminList } from "../hooks/useAdminList";
import { whatsappUrlFor } from "../utils/adminOrder";
import { formatEventDate } from "../utils/eventTime";
import { buildRestockMessage, restockMailto, restockOption } from "../utils/restock";
import type { AdminSectionProps } from "./adminSections";

/** The Restock requests list: who is waiting for a sold-out size or colour, and the buttons to tell them. */
export function AdminRestock({ onApiError }: AdminSectionProps) {
  const list = useAdminList(listRestockRequests, onApiError);
  const [busyId, setBusyId] = useState<string | null>(null);
  // The shop's address for the product links. Read after mount, not during render (SSR).
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Back in stock first; the server sends oldest first and the sort keeps that order inside each group.
  const rows = useMemo(
    () => [...list.data].sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0)),
    [list.data],
  );
  const back = list.data.filter((r) => r.stock > 0).length;

  const remove = async (r: RestockRequest) => {
    if (busyId) return;
    if (r.stock <= 0 && !window.confirm("Remove this request? They will not be told when it is back.")) return;
    setBusyId(r.id);
    try {
      await removeRestockRequest(r.id);
      toast.success(r.stock > 0 ? "Marked as told" : "Request removed");
      await list.reload();
    } catch (err) {
      onApiError(err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="admin-restock" className="space-y-6">
      <h3 id="admin-restock" className="display h-mid">Restock requests</h3>
      <p className="text-sm">{`${back} back in stock, ${list.data.length} waiting`}</p>

      {list.loading && list.data.length === 0 && <p className="micro text-b60">Loading restock requests…</p>}
      {list.error && <p className="text-b60">Couldn't load restock requests: {list.error}</p>}
      {!list.loading && !list.error && list.data.length === 0 && (
        <p className="text-b60 border border-b10 p-6">Nobody is waiting for a restock.</p>
      )}

      <ul className="space-y-3">
        {rows.map((r) => {
          const option = restockOption(r);
          const url = origin ? `${origin}/product/${r.productSlug}` : null;
          const wa = r.stock > 0 && r.phone && url ? whatsappUrlFor(r.phone, buildRestockMessage(r, url)) : null;
          return (
            <li key={r.id} className="border border-b10 r-card p-4">
              <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 mb-1">
                <p className="break-words">{r.productName}</p>
                <p className={`micro ${r.stock > 0 ? "text-ink" : "text-b60"}`}>
                  {r.stock > 0 ? `Back in stock (${r.stock})` : "Still out"}
                </p>
              </div>
              {option && <p className="text-sm">{option}</p>}
              <p className="text-sm break-all">{r.phone ?? r.email}</p>
              <p className="text-sm text-b60">Asked {formatEventDate(r.createdAt)}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {wa && (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="linkr min-h-11">
                    Message on WhatsApp
                  </a>
                )}
                {r.stock > 0 && r.email && url && (
                  <a href={restockMailto(r, url)} className="linkr min-h-11">
                    Send email
                  </a>
                )}
                <button type="button" className="linkr min-h-11" disabled={busyId === r.id} onClick={() => void remove(r)}>
                  {r.stock > 0 ? "Mark as told" : "Remove"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
