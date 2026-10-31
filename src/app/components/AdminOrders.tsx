import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Printer } from "lucide-react";
import { toast } from "../lib/toast";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ApiError } from "../api/client";
import {
  cancelOrder,
  extendOrder,
  listOrders,
  markOrderPaid,
  setOrderStatus,
  setOrderTracking,
  type AdminOrderStatus,
} from "../api/orders";
import type { Order, OrderStatus } from "../api/types";
import { deliveryLabel } from "../utils/orderMessage";
import { addressLine, buildOrderUpdateMessage, whatsappUrlFor } from "../utils/adminOrder";
import { loadProducts } from "../hooks/useProducts";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { AdminPackingList } from "./AdminPackingList";
import type { AdminSectionProps } from "./adminSections";

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });

const PAYMENT_FLAG_NOTE: Record<NonNullable<Order["paymentFlag"]>, string> = {
  refund_due: "Refund due",
  amount_mismatch: "Amount mismatch",
};

type Filter = "all" | "to_pack" | "packed" | "shipped" | "pending" | "finished";

const FILTERS: { id: Filter; label: string; statuses: OrderStatus[] | null }[] = [
  { id: "all", label: "All", statuses: null },
  { id: "to_pack", label: "To pack", statuses: ["paid"] },
  { id: "packed", label: "Packed", statuses: ["packed"] },
  { id: "shipped", label: "Shipped", statuses: ["shipped"] },
  { id: "pending", label: "Pending", statuses: ["pending", "awaiting_payment"] },
  { id: "finished", label: "Finished", statuses: ["delivered", "cancelled", "expired", "refunded"] },
];

/** The next step along the way, and what its button says while it runs. */
const NEXT_STEP: Partial<Record<OrderStatus, { to: AdminOrderStatus; label: string; busy: string }>> = {
  paid: { to: "packed", label: "Mark packed", busy: "Marking…" },
  packed: { to: "shipped", label: "Mark shipped", busy: "Marking…" },
  shipped: { to: "delivered", label: "Mark delivered", busy: "Marking…" },
};

/** Paid, packed or shipped, or cancelled or expired with a payment to pay back. */
const canRefund = (order: Order): boolean =>
  order.status === "paid" ||
  order.status === "packed" ||
  order.status === "shipped" ||
  (order.paymentFlag === "refund_due" && (order.status === "cancelled" || order.status === "expired"));

type BusyAction = "cancel" | "paid" | "status" | "refund" | "extend" | "tracking";

interface TrackingFormProps {
  order: Order;
  busy: boolean;
  saving: boolean;
  onSave: (order: Order, values: { courier: string; number: string; url: string }) => void;
}

/** Courier, number and link for a packed or shipped order. Starts from what is stored. */
function TrackingForm({ order, busy, saving, onSave }: TrackingFormProps) {
  const [courier, setCourier] = useState(order.tracking?.courier ?? "");
  const [number, setNumber] = useState(order.tracking?.number ?? "");
  const [url, setUrl] = useState(order.tracking?.url ?? "");
  const id = `tracking-${order.id}`;
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(order, { courier, number, url });
      }}
    >
      <label className="micro text-b60 flex flex-col gap-1 w-full sm:w-auto" htmlFor={`${id}-courier`}>
        Courier
        <Input
          id={`${id}-courier`}
          value={courier}
          maxLength={120}
          onChange={(e) => setCourier(e.target.value)}
          className="w-full sm:w-44"
        />
      </label>
      <label className="micro text-b60 flex flex-col gap-1 w-full sm:w-auto" htmlFor={`${id}-number`}>
        Tracking number
        <Input
          id={`${id}-number`}
          value={number}
          maxLength={120}
          onChange={(e) => setNumber(e.target.value)}
          className="w-full sm:w-44"
        />
      </label>
      <label className="micro text-b60 flex flex-col gap-1 grow max-w-md" htmlFor={`${id}-url`}>
        Tracking link
        <Input
          id={`${id}-url`}
          type="url"
          inputMode="url"
          placeholder="https://"
          value={url}
          maxLength={120}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <Button type="submit" variant="outline" size="sm" disabled={busy}>
        {saving ? "Saving…" : "Save tracking"}
      </Button>
    </form>
  );
}

const isWaiting = (order: Order): boolean => order.status === "pending" || order.status === "awaiting_payment";

/** What each button does. The same set drives the card (phone) and the table row (desktop). */
interface OrderHandlers {
  onMarkPaid: (order: Order) => void;
  onExtend: (order: Order) => void;
  onNext: (order: Order) => void;
  onCancel: (order: Order) => void;
  onRefund: (order: Order) => void;
}

interface OrderActionsProps extends OrderHandlers {
  order: Order;
  busy: { id: string; action: BusyAction } | null;
  /** Phone cards use bigger buttons. */
  large?: boolean;
}

/** Every action button for one order. Shared by the card and the table row. */
function OrderActions({ order, busy, large, ...on }: OrderActionsProps) {
  const mine = (action: BusyAction) => busy?.id === order.id && busy.action === action;
  const size = large ? "default" : "sm";
  const cls = large ? "min-h-10" : undefined;
  const step = NEXT_STEP[order.status];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {order.status === "pending" && (
        <Button variant="outline" size={size} className={cls} onClick={() => on.onMarkPaid(order)} disabled={busy !== null}>
          {mine("paid") ? "Marking…" : "Mark paid"}
        </Button>
      )}
      {order.status === "pending" && order.expiresAt && (
        <Button variant="outline" size={size} className={cls} onClick={() => on.onExtend(order)} disabled={busy !== null}>
          {mine("extend") ? "Extending…" : "Extend 48h"}
        </Button>
      )}
      {step && (
        <Button variant="outline" size={size} className={cls} onClick={() => on.onNext(order)} disabled={busy !== null}>
          {mine("status") ? step.busy : step.label}
        </Button>
      )}
      {isWaiting(order) && (
        <Button variant="outline" size={size} className={cls} onClick={() => on.onCancel(order)} disabled={busy !== null}>
          {mine("cancel") ? "Cancelling…" : "Cancel"}
        </Button>
      )}
      {canRefund(order) && (
        <Button variant="outline" size={size} className={cls} onClick={() => on.onRefund(order)} disabled={busy !== null}>
          {mine("refund") ? "Refunding…" : "Refund"}
        </Button>
      )}
    </div>
  );
}

/** Delivery method with the locker or address, in small text. Shared by the card and the table. */
function DeliveryInfo({ order }: { order: Order }) {
  if (!order.delivery) return null;
  const address = addressLine(order.delivery);
  return (
    <>
      <div className="text-b60 text-sm">{deliveryLabel(order.delivery.method)}</div>
      {order.delivery.locker && <div className="text-b60 text-sm break-words">{order.delivery.locker}</div>}
      {address && <div className="text-b60 text-sm break-words">{address}</div>}
    </>
  );
}

function OrderLines({ order }: { order: Order }) {
  return (
    <>
      {order.lines.map((line, i) => (
        <div key={`${line.productId}-${i}`}>
          {line.quantity} × {line.name}
          {line.size ? ` · ${line.size}` : ""}
          {line.color ? ` · ${line.color}` : ""}
        </div>
      ))}
    </>
  );
}

/** Status, any payment flag and the tracking summary. */
function OrderStatusInfo({ order }: { order: Order }) {
  return (
    <>
      <div className={`micro ${isWaiting(order) ? "text-brand" : "text-b60"}`}>{order.status.replace(/_/g, " ")}</div>
      {order.paymentFlag && <div className="text-b60 text-sm">{PAYMENT_FLAG_NOTE[order.paymentFlag]}</div>}
      {order.tracking && (order.tracking.courier || order.tracking.number) && (
        <div className="text-b60 text-sm">
          {[order.tracking.courier, order.tracking.number].filter(Boolean).join(" · ")}
        </div>
      )}
    </>
  );
}

const expiryText = (order: Order): string | null =>
  isWaiting(order) && order.expiresAt ? formatDate(order.expiresAt) : null;

interface TrackingProps {
  busy: { id: string; action: BusyAction } | null;
  onSaveTracking: (order: Order, values: { courier: string; number: string; url: string }) => void;
}

/** Remounts when the stored tracking changes, so the fields show what was saved. */
function OrderTrackingForm({ order, busy, onSaveTracking }: TrackingProps & { order: Order }) {
  return (
    <TrackingForm
      key={`${order.id}-${order.tracking?.courier ?? ""}-${order.tracking?.number ?? ""}-${order.tracking?.url ?? ""}`}
      order={order}
      busy={busy !== null}
      saving={busy?.id === order.id && busy.action === "tracking"}
      onSave={onSaveTracking}
    />
  );
}

const hasTrackingForm = (order: Order): boolean => order.status === "packed" || order.status === "shipped";

interface MessageLinkProps {
  order: Order;
  /** The shop's address, read after mount. Null until then, so no link is drawn on the server render. */
  origin: string | null;
}

/** Opens WhatsApp with a status update for the customer. Renders nothing when the number is unusable. */
function MessageLink({ order, origin }: MessageLinkProps) {
  if (!origin) return null;
  const href = whatsappUrlFor(order.customer.phone, buildOrderUpdateMessage(order, `${origin}/order/${order.id}`));
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="linkr text-ink min-h-11">
      Message on WhatsApp
    </a>
  );
}

/** One order as a card, for phones: everything stacked, nothing that needs sideways scrolling. */
function OrderCard({
  order,
  busy,
  origin,
  onSaveTracking,
  ...on
}: OrderHandlers & TrackingProps & MessageLinkProps & { order: Order }) {
  const expires = expiryText(order);
  return (
    <article aria-label={`Order ${order.ref}`} className="border border-b10 r-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-ink">{order.ref}</div>
          <div className="text-b60 text-sm">{formatDate(order.createdAt)}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-ink">R{order.total.toFixed(2)}</div>
          <OrderStatusInfo order={order} />
        </div>
      </div>
      {expires && (
        <div className="text-sm text-ink">
          <span className="micro text-b60">Expires </span>
          {expires}
        </div>
      )}
      <div className="text-ink min-w-0">
        <div className="break-words">{order.customer.name}</div>
        <div className="text-b60 text-sm break-words">{order.customer.phone}</div>
        <DeliveryInfo order={order} />
        {order.customer.note && <div className="text-b60 text-sm break-words">{order.customer.note}</div>}
      </div>
      <div className="text-ink">
        <OrderLines order={order} />
      </div>
      {hasTrackingForm(order) && <OrderTrackingForm order={order} busy={busy} onSaveTracking={onSaveTracking} />}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <OrderActions order={order} busy={busy} large {...on} />
        <MessageLink order={order} origin={origin} />
      </div>
    </article>
  );
}

/** The desktop table. Same blocks as the card, in columns. */
function OrdersTable({
  orders,
  busy,
  origin,
  onSaveTracking,
  ...on
}: OrderHandlers & TrackingProps & { orders: Order[] } & Pick<MessageLinkProps, "origin">) {
  return (
    <div className="border border-b10 r-card overflow-x-auto">
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
            <Fragment key={order.id}>
              {/* No divider between an order and its tracking form below it. */}
              <tr className={hasTrackingForm(order) ? "border-b-0" : undefined}>
                <td className="px-6 py-4 whitespace-nowrap text-ink">{formatDate(order.createdAt)}</td>
                <td className="px-6 py-4 whitespace-nowrap font-mono text-ink">{order.ref}</td>
                <td className="px-6 py-4 text-ink">
                  <div>{order.customer.name}</div>
                  <div className="text-b60 text-sm">{order.customer.phone}</div>
                  <DeliveryInfo order={order} />
                  {order.customer.note && <div className="text-b60 text-sm">{order.customer.note}</div>}
                </td>
                <td className="px-6 py-4 text-ink whitespace-nowrap">
                  <OrderLines order={order} />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-ink">R{order.total.toFixed(2)}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <OrderStatusInfo order={order} />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-ink">{expiryText(order) ?? "—"}</td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <OrderActions order={order} busy={busy} {...on} />
                    <MessageLink order={order} origin={origin} />
                  </div>
                </td>
              </tr>
              {hasTrackingForm(order) && (
                <tr>
                  <td colSpan={8} className="px-6 pb-4 pt-0">
                    <OrderTrackingForm order={order} busy={busy} onSaveTracking={onSaveTracking} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminOrders({ onApiError }: AdminSectionProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // One action at a time: the order id and which action it is running.
  const [busy, setBusy] = useState<{ id: string; action: BusyAction } | null>(null);
  const [packing, setPacking] = useState(false);
  // The filter lives in the address (?filter=), so the dashboard can link to "To pack" and a reload keeps it.
  const [params, setParams] = useSearchParams();
  const filter: Filter = FILTERS.find((f) => f.id === params.get("filter"))?.id ?? "all";
  const setFilter = (id: Filter) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("filter", id);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  // Cards below the md breakpoint (768px), the table from there up.
  const isDesktop = useMediaQuery("(min-width: 48rem)");
  // The shop's address for the order links in WhatsApp messages. Read after mount, not during render (SSR).
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

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

  // Runs one order action: replaces the order with the server's answer, and reloads the list on a 409
  // (the order is no longer where this screen thought it was).
  const runAction = async (
    order: Order,
    action: BusyAction,
    call: () => Promise<Order>,
    done: string,
    after?: () => Promise<unknown>,
  ) => {
    if (busy) return;
    setBusy({ id: order.id, action });
    try {
      const updated = await call();
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      if (after) await after();
      toast.success(done);
    } catch (err) {
      onApiErrorRef.current(err);
      if (err instanceof ApiError && err.status === 409) load().catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  const handleNext = (order: Order) => {
    const step = NEXT_STEP[order.status];
    if (!step) return;
    return runAction(order, "status", () => setOrderStatus(order.id, step.to), `${order.ref}: ${step.to}`);
  };

  const handleRefund = (order: Order) => {
    if (busy) return;
    if (
      !window.confirm(
        `Refund order ${order.ref}? Only do this after you have paid R${order.total.toFixed(2)} back. ` +
          `It can't be undone, and the stock is not returned.`,
      )
    )
      return;
    return runAction(order, "refund", () => setOrderStatus(order.id, "refunded"), `Refunded ${order.ref}`);
  };

  const handleExtend = (order: Order) =>
    runAction(order, "extend", () => extendOrder(order.id), `Extended ${order.ref} by 48 hours`);

  const handleSaveTracking = (
    order: Order,
    values: { courier: string; number: string; url: string },
  ) => {
    const url = values.url.trim();
    if (url !== "" && !/^https:\/\//i.test(url)) {
      toast.error("The tracking link has to start with https://");
      return;
    }
    return runAction(
      order,
      "tracking",
      () => setOrderTracking(order.id, values),
      `Saved tracking for ${order.ref}`,
    );
  };

  const handlers: OrderHandlers = {
    onMarkPaid: (o) => void handleMarkPaid(o),
    onExtend: (o) => void handleExtend(o),
    onNext: (o) => void handleNext(o),
    onCancel: (o) => void handleCancel(o),
    onRefund: (o) => void handleRefund(o),
  };

  const counts = (statuses: OrderStatus[] | null) =>
    statuses ? orders.filter((o) => statuses.includes(o.status)).length : orders.length;
  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const shown = active.statuses ? orders.filter((o) => active.statuses!.includes(o.status)) : orders;

  if (packing) {
    return (
      <AdminPackingList
        orders={orders.filter((o) => o.status === "paid")}
        loading={loading}
        error={error}
        onRefresh={() => load().catch(() => {})}
        onClose={() => setPacking(false)}
      />
    );
  }

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
        <h2 className="display h-mid">Orders</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setPacking(true);
              load().catch(() => {});
            }}
          >
            <Printer className="w-4 h-4 mr-2" />
            Packing list
          </Button>
          <Button variant="outline" onClick={() => load().catch(() => {})} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Filter orders by status">
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filter === f.id ? "default" : "outline"}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label} ({counts(f.statuses)})
          </Button>
        ))}
      </div>

      {loading && orders.length === 0 && (
        <p className="border border-b10 r-card px-6 py-4 micro text-b60">Loading orders…</p>
      )}
      {error && (
        <div className="border border-b10 r-card px-6 py-4 flex flex-wrap items-center gap-4">
          <p className="text-b60">Couldn't load orders: {error}</p>
          <Button variant="outline" onClick={() => load().catch(() => {})}>
            Retry
          </Button>
        </div>
      )}
      {!loading && !error && orders.length === 0 && (
        <p className="border border-b10 r-card px-6 py-4 text-b60">No orders yet.</p>
      )}
      {!loading && !error && orders.length > 0 && shown.length === 0 && (
        <p className="border border-b10 r-card px-6 py-4 text-b60">No {active.label.toLowerCase()} orders.</p>
      )}
      {shown.length > 0 &&
        (isDesktop ? (
          <OrdersTable orders={shown} busy={busy} origin={origin} onSaveTracking={handleSaveTracking} {...handlers} />
        ) : (
          <div className="space-y-3">
            {shown.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                busy={busy}
                origin={origin}
                onSaveTracking={handleSaveTracking}
                {...handlers}
              />
            ))}
          </div>
        ))}
    </div>
  );
}
