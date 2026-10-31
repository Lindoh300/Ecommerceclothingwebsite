import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "../lib/toast";
import { Button } from "./ui/button";
import { ApiError } from "../api/client";
import { cancelOrder, listOrders, markOrderPaid } from "../api/orders";
import type { Order } from "../api/types";
import { deliveryLabel } from "../utils/orderMessage";
import { loadProducts } from "../hooks/useProducts";

interface AdminOrdersProps {
  onApiError: (err: unknown) => void;
}

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });

const PAYMENT_FLAG_NOTE: Record<NonNullable<Order["paymentFlag"]>, string> = {
  refund_due: "Refund due",
  amount_mismatch: "Amount mismatch",
};

export function AdminOrders({ onApiError }: AdminOrdersProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // One action at a time: the order id and which action it is running.
  const [busy, setBusy] = useState<{ id: string; action: "cancel" | "paid" } | null>(null);

  // Keep the latest handler in a ref so the load effect runs once on mount,
  // not on every parent render (AdminPanel recreates handleApiError each render).
  const onApiErrorRef = useRef(onApiError);
  useEffect(() => {
    onApiErrorRef.current = onApiError;
  }, [onApiError]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrders(await listOrders());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      onApiErrorRef.current(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const handleCancel = async (order: Order) => {
    if (busy) return;
    if (!window.confirm(`Cancel order ${order.ref}? Its stock will be returned.`)) return;
    setBusy({ id: order.id, action: "cancel" });
    try {
      const updated = await cancelOrder(order.id);
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      await loadProducts(true);
      toast.success(`Cancelled ${order.ref}`);
    } catch (err) {
      onApiErrorRef.current(err);
      if (err instanceof ApiError && err.status === 409) load().catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  const handleMarkPaid = async (order: Order) => {
    if (busy) return;
    if (
      !window.confirm(
        `Mark order ${order.ref} as paid? This stops it being auto-cancelled.`,
      )
    )
      return;
    setBusy({ id: order.id, action: "paid" });
    try {
      const updated = await markOrderPaid(order.id);
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      toast.success(`Marked ${order.ref} paid`);
    } catch (err) {
      onApiErrorRef.current(err);
      if (err instanceof ApiError && err.status === 409) load().catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
        <h2 className="display h-mid">Orders</h2>
        <Button variant="outline" onClick={() => load().catch(() => {})} disabled={loading}>
          Refresh
        </Button>
      </div>

      <div className="border border-b10 r-card overflow-x-auto">
        {loading && orders.length === 0 && (
          <p className="px-6 py-4 micro text-b60">Loading orders…</p>
        )}
        {error && (
          <div className="px-6 py-4 flex flex-wrap items-center gap-4">
            <p className="text-b60">Couldn't load orders: {error}</p>
            <Button variant="outline" onClick={() => load().catch(() => {})}>
              Retry
            </Button>
          </div>
        )}
        {!loading && !error && orders.length === 0 && (
          <p className="px-6 py-4 text-b60">No orders yet.</p>
        )}
        {orders.length > 0 && (
          <table className="min-w-full text-left">
            <thead>
              <tr className="border-b border-b10">
                <th className="px-6 py-4 font-normal micro text-b60 whitespace-nowrap">Date</th>
                <th className="px-6 py-4 font-normal micro text-b60 whitespace-nowrap">Ref</th>
                <th className="px-6 py-4 font-normal micro text-b60 whitespace-nowrap">Customer</th>
                <th className="px-6 py-4 font-normal micro text-b60 whitespace-nowrap">Items</th>
                <th className="px-6 py-4 font-normal micro text-b60 whitespace-nowrap">Total</th>
                <th className="px-6 py-4 font-normal micro text-b60 whitespace-nowrap">Status</th>
                <th className="px-6 py-4 font-normal micro text-b60 whitespace-nowrap">Expires</th>
                <th className="px-6 py-4 font-normal micro text-b60 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-b10">
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-ink">{formatDate(order.createdAt)}</td>
                  <td className="px-6 py-4 whitespace-nowrap font-mono text-ink">{order.ref}</td>
                  <td className="px-6 py-4 text-ink">
                    <div>{order.customer.name}</div>
                    <div className="text-b60 text-sm">{order.customer.phone}</div>
                    {order.delivery && (
                      <>
                        <div className="text-b60 text-sm">{deliveryLabel(order.delivery.method)}</div>
                        {order.delivery.locker && (
                          <div className="text-b60 text-sm">{order.delivery.locker}</div>
                        )}
                        {order.delivery.address && (
                          <div className="text-b60 text-sm">
                            {[
                              order.delivery.address.line1,
                              order.delivery.address.line2,
                              order.delivery.address.suburb,
                              order.delivery.address.city,
                              order.delivery.address.postalCode,
                            ].filter(Boolean).join(", ")}
                          </div>
                        )}
                      </>
                    )}
                    {order.customer.note && (
                      <div className="text-b60 text-sm">{order.customer.note}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-ink">
                    {order.lines.map((line, i) => (
                      <div key={`${line.productId}-${i}`} className="whitespace-nowrap">
                        {line.quantity} × {line.name}
                        {line.size ? ` · ${line.size}` : ""}
                        {line.color ? ` · ${line.color}` : ""}
                      </div>
                    ))}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap font-mono text-ink">
                    R{order.total.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div
                      className={`micro ${
                        order.status === "pending" || order.status === "awaiting_payment"
                          ? "text-prism"
                          : "text-b60"
                      }`}
                    >
                      {order.status.replace(/_/g, " ")}
                    </div>
                    {order.paymentFlag && (
                      <div className="text-b60 text-sm">{PAYMENT_FLAG_NOTE[order.paymentFlag]}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-ink">
                    {(order.status === "pending" || order.status === "awaiting_payment") && order.expiresAt
                      ? formatDate(order.expiresAt)
                      : "—"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {order.status === "pending" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleMarkPaid(order)}
                          disabled={busy !== null}
                        >
                          {busy?.id === order.id && busy.action === "paid" ? "Marking…" : "Mark paid"}
                        </Button>
                      )}
                      {(order.status === "pending" || order.status === "awaiting_payment") && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCancel(order)}
                          disabled={busy !== null}
                        >
                          {busy?.id === order.id && busy.action === "cancel" ? "Cancelling…" : "Cancel"}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
