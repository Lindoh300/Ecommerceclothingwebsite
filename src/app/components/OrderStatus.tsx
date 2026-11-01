import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ExternalLink, MessageCircle } from "lucide-react";
import { toast } from "../lib/toast";
import { whatsappLink } from "../config/shop";
import { getPublicOrder, payOrder } from "../api/orders";
import { ApiError } from "../api/client";
import type { OrderStatus as Status, PublicOrder } from "../api/types";
import { deliveryLabel } from "../utils/orderMessage";
import { LoadState } from "./common/LoadState";

const STEPS = ["Placed", "Paid", "Packed", "Shipped", "Delivered"] as const;
// How far along the timeline each live status is (index of the last reached step).
const STEP_INDEX: Partial<Record<Status, number>> = {
  pending: 0,
  awaiting_payment: 0,
  paid: 1,
  packed: 2,
  shipped: 3,
  delivered: 4,
};
const END_STATES: Partial<Record<Status, { title: string; text: string }>> = {
  cancelled: { title: "Cancelled", text: "This order was cancelled." },
  expired: { title: "Expired", text: "This order was not paid in time and has expired." },
  refunded: { title: "Refunded", text: "This order was refunded." },
};
const POLL_MS = 3000;
const POLL_MAX = 10;

const money = (n: number) => `R${n.toFixed(2)}`;

/** Local date and time. Only called after mount, so the server and client HTML match. */
const formatTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });
};

export function OrderStatus() {
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  const returnedFromPayment = searchParams.get("paid") === "1";
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [polls, setPolls] = useState(0);
  const [mounted, setMounted] = useState(false);
  const live = useRef(true);

  useEffect(() => {
    setMounted(true);
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const o = await getPublicOrder(id);
      if (live.current) setOrder(o);
    } catch (err) {
      if (!live.current) return;
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof Error ? err.message : "Could not load your order");
    } finally {
      if (live.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Back from the payment page: the webhook may land a moment after the customer does.
  const confirming = returnedFromPayment && order?.status === "awaiting_payment" && polls < POLL_MAX;
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => {
      getPublicOrder(id)
        .then((o) => {
          if (live.current) setOrder(o);
        })
        .catch(() => {})
        .finally(() => {
          if (live.current) setPolls((n) => n + 1);
        });
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [confirming, polls, id]);

  const handlePay = async () => {
    if (!order || paying) return;
    setPaying(true);
    try {
      const { redirectUrl } = await payOrder(order.id);
      if (typeof redirectUrl !== "string" || !redirectUrl) throw new Error("No payment link");
      window.location.assign(redirectUrl);
    } catch (err) {
      setPaying(false);
      if (err instanceof ApiError && err.status === 409) {
        toast.error("This order can't be paid", { description: "Its status has changed." });
        load();
      } else if (err instanceof ApiError && err.status === 503) {
        toast.error("Online payment is not available right now", { description: "Please try again later." });
      } else {
        toast.error("Could not start the payment", { description: "Please try again." });
      }
    }
  };

  return (
    <div className="min-h-screen bg-paper py-12 md:py-16">
      <div className="max-w-3xl mx-auto px-6">
        <LoadState loading={loading && !order} error={order ? null : error} onRetry={load}>
          {notFound ? (
            <div className="text-center py-12">
              <p className="page-kicker micro text-b60 mb-3">Your order</p>
              <h1 className="display h-sec mb-6">Order not found</h1>
              <p className="text-b60 mb-10">We couldn't find that order. You can look it up with its reference and your phone number.</p>
              <Link to="/track" className="cta">Track an order</Link>
            </div>
          ) : order ? (
            <OrderBody
              order={order}
              mounted={mounted}
              confirming={confirming}
              gaveUpConfirming={returnedFromPayment && order.status === "awaiting_payment" && !confirming}
              paying={paying}
              onPay={handlePay}
            />
          ) : null}
        </LoadState>
      </div>
    </div>
  );
}

function OrderBody({
  order,
  mounted,
  confirming,
  gaveUpConfirming,
  paying,
  onPay,
}: {
  order: PublicOrder;
  mounted: boolean;
  confirming: boolean;
  gaveUpConfirming: boolean;
  paying: boolean;
  onPay: () => void;
}) {
  const end = END_STATES[order.status];
  const reached = STEP_INDEX[order.status] ?? 0;
  const t = order.tracking;
  const hasTracking = !!t && (t.number || t.courier || t.url);
  const discountAmount = order.discountAmount ?? 0;
  // `total` is net of the discount, so add it back to show the goods before the discount.
  const itemsTotal = order.total - order.deliveryFee + discountAmount;

  return (
    <div>
      <p className="page-kicker micro text-b60 mb-3">Your order</p>
      <h1 className="display h-sec mb-2 break-words">{order.ref}</h1>
      {mounted && <p className="micro text-b60 mb-8">Placed {formatTime(order.createdAt)}</p>}

      {confirming && (
        <p role="status" className="border border-b10 r-card p-4 mb-8">Confirming your payment…</p>
      )}
      {gaveUpConfirming && (
        <p role="status" className="border border-b10 r-card p-4 mb-8 text-b60">
          We haven't received your payment yet. This can take a few minutes. Refresh this page to check again.
        </p>
      )}

      {end ? (
        <div className="border border-brand p-4 mb-8" role="status">
          <p className="font-display h-weight h-case h-track-sm">{end.title}</p>
          <p className="text-b60 text-sm">{end.text}</p>
        </div>
      ) : (
        <ol className="mb-8 grid grid-cols-5 gap-1" aria-label="Order progress">
          {STEPS.map((label, i) => {
            const done = i <= reached;
            return (
              <li key={label} className="min-w-0" aria-current={i === reached ? "step" : undefined}>
                <div className={`h-1 mb-2 ${done ? "bg-brand" : "bg-b10"}`} />
                <p className={`micro break-words ${done ? "text-ink" : "text-b60"}`}>
                  {label}
                  <span className="sr-only">{done ? " (done)" : " (not yet)"}</span>
                </p>
              </li>
            );
          })}
        </ol>
      )}

      {order.status === "awaiting_payment" && (
        <div className="mb-8">
          <button type="button" onClick={onPay} disabled={paying} className="cta">
            {paying ? "Opening payment…" : "Pay now"}
          </button>
          {mounted && order.expiresAt && (
            <p className="text-sm text-b60 mt-3">Pay before {formatTime(order.expiresAt)} or the order expires.</p>
          )}
        </div>
      )}
      {order.status === "pending" && (
        <div className="mb-8">
          <a
            href={whatsappLink(`Hi! I'd like to pay for order ${order.ref}.`)}
            target="_blank"
            rel="noopener noreferrer"
            className="cta"
          >
            <MessageCircle className="w-5 h-5" />
            Pay on WhatsApp
          </a>
          {mounted && order.expiresAt && (
            <p className="text-sm text-b60 mt-3">Unpaid orders expire on {formatTime(order.expiresAt)}.</p>
          )}
        </div>
      )}

      {hasTracking && (
        <div className="border border-b10 r-card p-4 mb-8 space-y-1">
          <p className="micro text-b60 mb-2">Tracking</p>
          {t.courier && <p>Courier: {t.courier}</p>}
          {t.number && <p className="break-words">Tracking number: <span className="font-mono">{t.number}</span></p>}
          {t.url && /^https?:\/\//i.test(t.url) && (
            <a href={t.url} target="_blank" rel="noopener noreferrer" className="linkr inline-flex items-center gap-2">
              Track your parcel <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>
      )}

      <p className="micro text-b60 mb-3">Items</p>
      <div className="border-t border-b10 mb-6">
        {order.lines.map((line, i) => (
          <div key={i} className="flex justify-between gap-4 py-3 border-b border-b10">
            <div className="min-w-0">
              <p className="break-words">{line.name}</p>
              <p className="micro text-b60">
                {[line.size && `Size: ${line.size}`, line.color && `Color: ${line.color}`, `Qty: ${line.quantity}`]
                  .filter(Boolean)
                  .join(" | ")}
              </p>
            </div>
            <p className="shrink-0">{money(line.subtotal)}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2 text-sm mb-10">
        <div className="flex justify-between">
          <span className="text-b60">Items</span>
          <span>{money(itemsTotal)}</span>
        </div>
        {discountAmount > 0 && (
          <div className="flex justify-between gap-4">
            <span className="text-b60 min-w-0 break-words">Discount ({order.discountCode})</span>
            <span className="shrink-0">-{money(discountAmount)}</span>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <span className="text-b60 min-w-0 break-words">
            {order.delivery
              ? `${deliveryLabel(order.delivery.method)}${order.delivery.locker ? `: ${order.delivery.locker}` : ""}`
              : "Delivery"}
          </span>
          <span className="shrink-0">{order.delivery ? (order.deliveryFee === 0 ? "Free" : money(order.deliveryFee)) : "-"}</span>
        </div>
        <div className="flex justify-between text-base">
          <span>Total</span>
          <span>{money(order.total)}</span>
        </div>
      </div>

      <Link to="/track" className="linkr">Track another order</Link>
    </div>
  );
}
