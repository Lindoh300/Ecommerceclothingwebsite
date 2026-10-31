import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { MessageCircle } from "lucide-react";
import { toast } from "../lib/toast";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { whatsappLink } from "../config/shop";
import { getShopConfig, listDeliveryOptions, payOrder, placeOrder } from "../api/orders";
import { ApiError } from "../api/client";
import type { CartQuoteItem, DeliveryInput, DeliveryMethod, DeliveryOption, Order, PaymentMethod, StockShortfall } from "../api/types";
import { buildOrderMessage, deliveryLabel } from "../utils/orderMessage";

interface CheckoutPanelProps {
  items: CartQuoteItem[];
  blocked: boolean;
  onStockShort: () => void;
  onCartCleared: () => void;
  onOrderChange: (placed: boolean) => void;
  /** The server's items total from the cart quote, without delivery. */
  itemsTotal?: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(name: string, phone: string, note: string, email: string, payment: PaymentMethod): Record<string, string> {
  const errors: Record<string, string> = {};
  const n = name.trim();
  const p = phone.trim();
  if (n.length < 1 || n.length > 80) errors.name = "Enter your name (up to 80 characters)";
  if (p.length < 7 || p.length > 20 || !/^[0-9 +\-()]+$/.test(p) || p.replace(/\D/g, "").length < 7) {
    errors.phone = "Enter a valid phone number (at least 7 digits)";
  }
  const e = email.trim();
  if (e && (e.length > 254 || !EMAIL_RE.test(e))) errors.email = "Enter a valid email address";
  else if (!e && payment === "online") errors.email = "Email is needed to pay online";
  if (note.trim().length > 500) errors.note = "Note is too long (500 characters max)";
  return errors;
}

interface AddressFields {
  line1: string;
  line2: string;
  suburb: string;
  city: string;
  postalCode: string;
}

const EMPTY_ADDRESS: AddressFields = { line1: "", line2: "", suburb: "", city: "", postalCode: "" };
const OPTIONS_TIMEOUT_MS = 8000;

const money = (n: number) => `R${n.toFixed(2)}`;
const priceLabel = (n: number) => (n === 0 ? "Free" : money(n));

function validateDelivery(method: string | null, address: AddressFields, locker: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!method) {
    errors.delivery = "Choose how you want to receive your order";
  } else if (method === "door") {
    if (!address.line1.trim()) errors.line1 = "Enter your street address";
    if (!address.suburb.trim()) errors.suburb = "Enter your suburb";
    if (!address.city.trim()) errors.city = "Enter your city";
    if (!/^\d{4}$/.test(address.postalCode.trim())) errors.postalCode = "Enter a 4 digit postal code";
    for (const [k, v] of Object.entries(address)) {
      if (v.trim().length > 120) errors[k] = "Too long (120 characters max)";
    }
  } else if (method === "locker") {
    const l = locker.trim();
    if (!l) errors.locker = "Enter the locker name or code";
    else if (l.length > 120) errors.locker = "Too long (120 characters max)";
  }
  return errors;
}

export function CheckoutPanel({ items, blocked, onStockShort, onCartCleared, onOrderChange, itemsTotal }: CheckoutPanelProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("whatsapp");
  // Loaded after mount. Until it answers, and when it fails, online payment is off.
  const [onlinePayments, setOnlinePayments] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const navigate = useNavigate();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const orderId = useRef<string | null>(null);
  const inFlight = useRef(false);
  // Delivery options load after mount (never during render). null while loading, [] when the
  // load failed or there are none: then the customer orders without delivery.
  const [options, setOptions] = useState<DeliveryOption[] | null>(null);
  const [optionsFailed, setOptionsFailed] = useState(false);
  const [method, setMethod] = useState<string | null>(null);
  const [address, setAddress] = useState<AddressFields>(EMPTY_ADDRESS);
  const [locker, setLocker] = useState("");

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      if (live) {
        setOptions([]);
        setOptionsFailed(true);
      }
    }, OPTIONS_TIMEOUT_MS);
    listDeliveryOptions()
      .then((list) => {
        if (live) setOptions(list);
      })
      .catch(() => {
        if (live) {
          setOptions([]);
          setOptionsFailed(true);
        }
      })
      .finally(() => clearTimeout(timer));
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let live = true;
    getShopConfig().then((config) => {
      if (live) setOnlinePayments(config.onlinePayments);
    });
    return () => {
      live = false;
    };
  }, []);

  const loadingOptions = options === null;
  const chosen = options?.find((o) => o.id === method) ?? null;
  const setAddr = (k: keyof AddressFields, v: string) => setAddress((a) => ({ ...a, [k]: v }));

  const itemsKey = JSON.stringify(items);
  useEffect(() => {
    // Cart changed: a previous attempt's id no longer matches these lines.
    orderId.current = null;
  }, [itemsKey]);

  // Online: the order is saved, so the cart is cleared before the customer leaves. If the payment
  // can't be started, the order page offers Pay again.
  const startPayment = async (placed: Order) => {
    setRedirecting(true);
    onCartCleared();
    try {
      const { redirectUrl } = await payOrder(placed.id);
      if (typeof redirectUrl !== "string" || !redirectUrl) throw new Error("No payment link");
      window.location.assign(redirectUrl);
    } catch {
      toast.error("Could not start the payment", { description: "Your order is saved. You can pay from your order page." });
      navigate(`/order/${encodeURIComponent(placed.id)}`);
    }
  };

  const handlePlaceOrder = async () => {
    if (inFlight.current || order) return;
    const found = {
      ...validate(name, phone, note, email, payment),
      ...(options && options.length > 0 ? validateDelivery(chosen ? chosen.id : null, address, locker) : {}),
    };
    setErrors(found);
    if (Object.keys(found).length > 0) {
      toast.error("Check your details", { description: Object.values(found)[0] });
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    if (!orderId.current) orderId.current = crypto.randomUUID();
    try {
      const trimmedNote = note.trim();
      let delivery: DeliveryInput | undefined;
      if (chosen) {
        delivery = { method: chosen.id as DeliveryMethod };
        if (chosen.id === "door") {
          const line2 = address.line2.trim();
          delivery.address = {
            line1: address.line1.trim(),
            ...(line2 ? { line2 } : {}),
            suburb: address.suburb.trim(),
            city: address.city.trim(),
            postalCode: address.postalCode.trim(),
          };
        } else if (chosen.id === "locker") {
          delivery.locker = locker.trim();
        }
      }
      const placed = await placeOrder({
        id: orderId.current,
        items: JSON.parse(itemsKey) as CartQuoteItem[],
        customer: {
          name: name.trim(),
          phone: phone.trim(),
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(trimmedNote ? { note: trimmedNote } : {}),
        },
        ...(delivery ? { delivery } : {}),
        paymentMethod: payment,
      });
      setOrder(placed);
      onOrderChange(true);
      if (payment === "online") await startPayment(placed);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        orderId.current = null;
        const short = ((err.body as { short?: StockShortfall[] } | undefined)?.short ?? []);
        toast.error("Not enough stock", {
          description: short.length
            ? short
                .map((s) => {
                  const option = [s.size, s.color].filter(Boolean).join(", ");
                  return `${s.name}${option ? ` (${option})` : ""}: only ${s.available} left`;
                })
                .join(", ")
            : "Some items are no longer available in that quantity.",
        });
        onStockShort();
      } else if (err instanceof ApiError && err.status === 400 && err.message === "Unknown delivery option") {
        // The shop changed its options since this page loaded: show the current ones.
        setMethod(null);
        setOptions(null);
        listDeliveryOptions()
          .then(setOptions)
          .catch(() => {
            setOptions([]);
            setOptionsFailed(true);
          });
        toast.error("That delivery option is no longer available", { description: "Choose another one and try again." });
      } else if (err instanceof ApiError && err.status === 400 && (err.body as { missing?: unknown } | undefined)?.missing) {
        orderId.current = null;
        toast.error("Some items are no longer available", { description: "Remove them from your cart and try again." });
        onStockShort();
      } else if (err instanceof ApiError && err.status === 429) {
        // No order was created, so the id is kept and a retry is safe.
        toast.error("Order limit reached", { description: err.message });
      } else if (
        err instanceof ApiError &&
        err.status === 400 &&
        (err.body as { code?: unknown } | undefined)?.code === "too_many_units"
      ) {
        toast.error("Too many items in one order", { description: err.message });
      } else {
        toast.error("Could not place your order", {
          description: err instanceof Error ? `${err.message}. Please try again.` : "Please try again.",
        });
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const handleSendWhatsApp = () => {
    if (!order) return;
    window.open(whatsappLink(buildOrderMessage(order, `${window.location.origin}/order/${encodeURIComponent(order.id)}`)), "_blank");
    setAwaitingConfirm(true);
  };

  const handleConfirmSent = () => {
    onCartCleared();
    setAwaitingConfirm(false);
    setOrder(null);
    onOrderChange(false);
    orderId.current = null;
    toast.success("Order sent", { description: "Thanks! We will reply on WhatsApp." });
  };

  return (
    <div>
      {order ? (
        <div className="border border-b10 r-card p-4 mb-4">
          <p className="micro text-b60 mb-2">Order {order.ref} saved</p>
          {order.delivery && (
            <div className="flex justify-between mb-2">
              <span>
                {deliveryLabel(order.delivery.method)}
                {order.delivery.locker ? `: ${order.delivery.locker}` : ""}
              </span>
              <span>{priceLabel(order.delivery.fee)}</span>
            </div>
          )}
          <div className="flex justify-between mb-2">
            <span>Total</span>
            <span>R{order.total.toFixed(2)}</span>
          </div>
          {redirecting ? (
            <p className="text-b60 text-sm" role="status">Taking you to the payment page…</p>
          ) : (
            <>
              <p className="text-b60 text-sm mb-2">Now send it to us on WhatsApp so we can confirm.</p>
              <Link to={`/order/${encodeURIComponent(order.id)}`} className="linkr">View order status</Link>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4 mb-4">
          <p className="micro text-b60">Your details</p>
          <div className="space-y-1">
            <Label htmlFor="checkout-name">Name</Label>
            <Input
              id="checkout-name"
              value={name}
              maxLength={80}
              autoComplete="name"
              disabled={submitting}
              aria-invalid={!!errors.name}
              onChange={(e) => setName(e.target.value)}
            />
            {errors.name && <p className="text-sm text-brand">{errors.name}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="checkout-phone">Phone</Label>
            <Input
              id="checkout-phone"
              type="tel"
              value={phone}
              maxLength={20}
              autoComplete="tel"
              disabled={submitting}
              aria-invalid={!!errors.phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            {errors.phone && <p className="text-sm text-brand">{errors.phone}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="checkout-email">{payment === "online" ? "Email" : "Email (optional)"}</Label>
            <Input
              id="checkout-email"
              type="email"
              value={email}
              maxLength={254}
              autoComplete="email"
              disabled={submitting}
              aria-invalid={!!errors.email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {errors.email && <p className="text-sm text-brand">{errors.email}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="checkout-note">Note (optional)</Label>
            <Textarea
              id="checkout-note"
              value={note}
              maxLength={500}
              disabled={submitting}
              aria-invalid={!!errors.note}
              onChange={(e) => setNote(e.target.value)}
            />
            {errors.note && <p className="text-sm text-brand">{errors.note}</p>}
          </div>

          {loadingOptions && <p className="text-sm text-b60">Loading delivery options…</p>}
          {optionsFailed && (
            <p className="text-sm text-b60">
              Delivery options could not be loaded. You can still place your order and we will sort out delivery with you on WhatsApp.
            </p>
          )}
          {options && options.length > 0 && (
            <fieldset className="space-y-2" disabled={submitting} aria-describedby={errors.delivery ? "checkout-delivery-error" : undefined}>
              <legend className="micro text-b60 mb-2">Delivery</legend>
              {options.map((o) => (
                <label
                  key={o.id}
                  className={`flex items-center justify-between gap-4 border p-3 cursor-pointer r-card ${
                    method === o.id ? "border-brand" : "border-b10"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="checkout-delivery"
                      value={o.id}
                      checked={method === o.id}
                      className="accent-brand"
                      onChange={() => setMethod(o.id)}
                    />
                    {o.name}
                  </span>
                  <span>{priceLabel(o.price)}</span>
                </label>
              ))}
              {errors.delivery && (
                <p id="checkout-delivery-error" role="alert" className="text-sm text-brand">
                  {errors.delivery}
                </p>
              )}
            </fieldset>
          )}
          {chosen?.id === "door" && (
            <div className="space-y-4">
              {(
                [
                  ["line1", "Street address", "address-line1"],
                  ["line2", "Apartment, complex (optional)", "address-line2"],
                  ["suburb", "Suburb", "address-level3"],
                  ["city", "City", "address-level2"],
                  ["postalCode", "Postal code", "postal-code"],
                ] as const
              ).map(([key, label, auto]) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`checkout-${key}`}>{label}</Label>
                  <Input
                    id={`checkout-${key}`}
                    value={address[key]}
                    maxLength={key === "postalCode" ? 4 : 120}
                    inputMode={key === "postalCode" ? "numeric" : undefined}
                    autoComplete={auto}
                    disabled={submitting}
                    aria-invalid={!!errors[key]}
                    onChange={(e) => setAddr(key, e.target.value)}
                  />
                  {errors[key] && <p className="text-sm text-brand">{errors[key]}</p>}
                </div>
              ))}
            </div>
          )}
          {chosen?.id === "locker" && (
            <div className="space-y-1">
              <Label htmlFor="checkout-locker">Locker name or code</Label>
              <Input
                id="checkout-locker"
                value={locker}
                maxLength={120}
                disabled={submitting}
                aria-invalid={!!errors.locker}
                onChange={(e) => setLocker(e.target.value)}
              />
              {errors.locker && <p className="text-sm text-brand">{errors.locker}</p>}
            </div>
          )}
          <fieldset className="space-y-2" disabled={submitting}>
            <legend className="micro text-b60 mb-2">Payment</legend>
            {(
              [
                ["whatsapp", "Pay on WhatsApp", "We confirm on WhatsApp and send payment details."],
                ...(onlinePayments ? [["online", "Pay online", "Pay by card or bank on a secure page. Email needed."]] : []),
              ] as [PaymentMethod, string, string][]
            ).map(([id, label, hint]) => (
              <label
                key={id}
                className={`flex items-start gap-3 border p-3 cursor-pointer r-card ${payment === id ? "border-brand" : "border-b10"}`}
              >
                <input
                  type="radio"
                  name="checkout-payment"
                  value={id}
                  checked={payment === id}
                  className="accent-brand mt-1"
                  onChange={() => setPayment(id)}
                />
                <span className="min-w-0">
                  <span className="block">{label}</span>
                  <span className="block text-sm text-b60">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="border-t border-b10 pt-4 space-y-2 text-sm">
            <p className="micro text-b60">Summary</p>
            <div className="flex justify-between">
              <span className="text-b60">Items</span>
              <span>{typeof itemsTotal === "number" ? money(itemsTotal) : "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-b60">Delivery</span>
              <span>{chosen ? priceLabel(chosen.price) : "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-b60">Estimated total</span>
              <span>
                {typeof itemsTotal === "number" && (chosen || !(options && options.length > 0))
                  ? money(itemsTotal + (chosen?.price ?? 0))
                  : "-"}
              </span>
            </div>
          </div>
        </div>
      )}

      {order && redirecting ? null : order ? (
        <button onClick={handleSendWhatsApp} className="cta w-full">
          <MessageCircle className="w-5 h-5" />
          {awaitingConfirm ? "Open WhatsApp again" : "Send on WhatsApp"}
        </button>
      ) : (
        <button onClick={handlePlaceOrder} disabled={blocked || submitting || loadingOptions} className="cta w-full">
          {submitting ? "Placing order…" : payment === "online" ? "Place order and pay" : "Place order"}
        </button>
      )}

      {order && !redirecting && awaitingConfirm && (
        <div className="border border-b10 r-card p-4 mt-4">
          <p className="micro text-b60 mb-2">Did you send your order?</p>
          <p className="text-b60 text-sm mb-4">
            Your cart is kept until you confirm, in case WhatsApp didn't send.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <button onClick={handleConfirmSent} className="cta">
              Yes, clear cart
            </button>
            <button onClick={() => setAwaitingConfirm(false)} className="linkr">
              Not yet
            </button>
          </div>
        </div>
      )}
      <p className="micro text-b60 text-center mt-4 text-xs">
        {payment === "online"
          ? "Your order is saved first, then you pay on a secure page."
          : "Your order is saved first, then sent to us on WhatsApp."}
      </p>
    </div>
  );
}
