import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Check, Copy, MessageCircle, Minus, Plus, Trash2 } from "lucide-react";
import { toast } from "../lib/toast";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { ApiError } from "../api/client";
import { checkDiscountCode, createAdminOrder, getShopConfig, listDeliveryOptions } from "../api/orders";
import { listAllProducts } from "../api/products";
import type { CartQuoteItem, DeliveryAddress, DeliveryInput, Order, Product, StockShortfall, Variant } from "../api/types";
import { loadProducts } from "../hooks/useProducts";
import { useAdminList } from "../hooks/useAdminList";
import { buildOrderLinkMessage, whatsappUrlFor } from "../utils/adminOrder";
import { sectionHref, type AdminSectionProps } from "./adminSections";
import { AdminOrderLinePicker, MAX_LINES, MAX_LINE_QUANTITY, variantLabel } from "./AdminOrderLinePicker";

/** One line of the order being built: a variant and how many. */
interface DraftLine {
  productId: string;
  variantId: string;
  quantity: number;
}

type PayChoice = "whatsapp" | "online";

const EMPTY_ADDRESS: DeliveryAddress = { line1: "", line2: "", suburb: "", city: "", postalCode: "" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const money = (n: number): string => `R${n.toFixed(2)}`;
const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });

type Errors = Partial<Record<"lines" | "name" | "phone" | "email" | "delivery" | "address" | "locker", string>>;

/** The order link a customer opens: the same page the checkout sends them to. */
const orderLinkFor = (order: Order): string => `${window.location.origin}/order/${order.id}`;

/** The New order section: the owner enters an order for a customer, then sends them its link. */
export function AdminNewOrder({ onApiError }: AdminSectionProps) {
  const productList = useAdminList(listAllProducts, onApiError);
  const delivery = useAdminList(listDeliveryOptions);
  // null until /config answers; false when it fails or payments are off.
  const [onlinePayments, setOnlinePayments] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    getShopConfig().then((c) => {
      if (!cancelled) setOnlinePayments(c.onlinePayments);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [deliveryId, setDeliveryId] = useState("");
  const [address, setAddress] = useState<DeliveryAddress>(EMPTY_ADDRESS);
  const [locker, setLocker] = useState("");
  const [pay, setPay] = useState<PayChoice>("whatsapp");
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Per line (by variant id): what the server said was short on the last try.
  const [shortages, setShortages] = useState<Record<string, StockShortfall>>({});
  const [created, setCreated] = useState<Order | null>(null);
  // One id per attempt, so a retry or a double tap is one order. Made on the first submit (never while rendering),
  // kept until the order is created or the form is reset.
  const attemptId = useRef<string | null>(null);
  // Discount code. `applied` remembers the items it was checked against (`key`); when the lines change it is stale
  // and not sent.
  const [codeInput, setCodeInput] = useState("");
  const [applied, setApplied] = useState<{ code: string; amount: number; key: string } | null>(null);
  const [codeError, setCodeError] = useState("");
  const [checkingCode, setCheckingCode] = useState(false);

  // Online payment can be switched off while the form is open: fall back to the other choice.
  useEffect(() => {
    if (onlinePayments === false && pay === "online") setPay("whatsapp");
  }, [onlinePayments, pay]);

  // Pick the first delivery option once they load.
  useEffect(() => {
    if (deliveryId === "" && delivery.data.length > 0) {
      setDeliveryId((delivery.data.find((d) => d.id === "collect") ?? delivery.data[0]).id);
    }
  }, [delivery.data, deliveryId]);

  const products = productList.data.filter((p) => p.active);
  const findProduct = (id: string): Product | undefined => productList.data.find((p) => p.id === id);
  const findVariant = (l: DraftLine): Variant | undefined =>
    findProduct(l.productId)?.variants.find((v) => v.id === l.variantId);
  const chosenDelivery = delivery.data.find((d) => d.id === deliveryId);

  /** The lines as the server takes them: used for the order and for checking a code. */
  const orderItems = (): CartQuoteItem[] =>
    lines.map((l) => {
      const v = findVariant(l);
      return {
        productId: l.productId,
        ...(v?.size ? { size: v.size } : {}),
        ...(v?.color ? { color: v.color } : {}),
        quantity: l.quantity,
      };
    });

  const itemsKey = JSON.stringify(orderItems());
  const itemsKeyRef = useRef(itemsKey);
  useEffect(() => {
    itemsKeyRef.current = itemsKey;
  }, [itemsKey]);
  const discount = applied && applied.key === itemsKey ? applied : null;
  const codeStale = !!applied && applied.key !== itemsKey;

  const itemsTotal = lines.reduce((sum, l) => sum + (findProduct(l.productId)?.price ?? 0) * l.quantity, 0);
  const estimate = Math.max(0, itemsTotal + (chosenDelivery?.price ?? 0) - (discount?.amount ?? 0));

  const handleApplyCode = async () => {
    const code = codeInput.trim();
    if (!code) {
      setCodeError("Enter a discount code");
      return;
    }
    if (lines.length === 0) {
      setCodeError("Add an item first");
      return;
    }
    if (checkingCode || submitting) return;
    const key = itemsKey;
    setCheckingCode(true);
    setCodeError("");
    try {
      const result = await checkDiscountCode(JSON.parse(key) as CartQuoteItem[], code);
      if (itemsKeyRef.current !== key) {
        setApplied(null);
        setCodeError("Check your code again");
      } else if (typeof result.amount === "number") {
        attemptId.current = null; // the body changes, so a new attempt gets a new id
        setApplied({ code: result.code, amount: result.amount, key });
      } else {
        setApplied(null);
        setCodeError(result.error ?? "That code is not valid");
      }
    } catch {
      setApplied(null);
      setCodeError("Could not check the code. Please try again.");
    } finally {
      setCheckingCode(false);
    }
  };

  const handleRemoveCode = () => {
    attemptId.current = null;
    setApplied(null);
    setCodeError("");
    setCodeInput("");
  };

  const addLine = (product: Product, variant: Variant, quantity: number): boolean => {
    const existing = lines.find((l) => l.variantId === variant.id);
    if (!existing && lines.length >= MAX_LINES) {
      toast.error(`An order can have up to ${MAX_LINES} different items`);
      return false;
    }
    if (existing && existing.quantity + quantity > MAX_LINE_QUANTITY) {
      toast.error(`Up to ${MAX_LINE_QUANTITY} of one item: split it over two orders`);
      return false;
    }
    setLines((prev) =>
      existing
        ? prev.map((l) => (l.variantId === variant.id ? { ...l, quantity: l.quantity + quantity } : l))
        : [...prev, { productId: product.id, variantId: variant.id, quantity }],
    );
    setErrors((e) => ({ ...e, lines: undefined }));
    setShortages({});
    return true;
  };

  const setQuantity = (variantId: string, quantity: number) => {
    if (quantity < 1) return;
    setLines((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, quantity: Math.min(quantity, MAX_LINE_QUANTITY) } : l)));
    setShortages((s) => {
      const { [variantId]: _drop, ...rest } = s;
      return rest;
    });
  };

  const removeLine = (variantId: string) => setLines((prev) => prev.filter((l) => l.variantId !== variantId));

  /** The delivery as the server wants it, or an error for the field. */
  const deliveryInput = (): { value?: DeliveryInput; errors: Errors } => {
    if (!chosenDelivery) return { errors: {} };
    const method = chosenDelivery.id as DeliveryInput["method"];
    if (method === "collect") return { value: { method }, errors: {} };
    if (method === "locker") {
      if (!locker.trim()) return { errors: { locker: "Enter the locker name or code" } };
      return { value: { method, locker: locker.trim() }, errors: {} };
    }
    const a = address;
    if (!a.line1.trim() || !a.suburb.trim() || !a.city.trim()) {
      return { errors: { address: "Enter the street, suburb and city" } };
    }
    if (!/^\d{4}$/.test(a.postalCode.trim())) return { errors: { address: "The postal code is 4 digits" } };
    return {
      value: {
        method,
        address: {
          line1: a.line1.trim(),
          ...(a.line2?.trim() ? { line2: a.line2.trim() } : {}),
          suburb: a.suburb.trim(),
          city: a.city.trim(),
          postalCode: a.postalCode.trim(),
        },
      },
      errors: {},
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const d = deliveryInput();
    const errs: Errors = { ...d.errors };
    if (lines.length === 0) errs.lines = "Add at least one item";
    if (!name.trim()) errs.name = "Enter the customer's name";
    const digits = phone.replace(/\D/g, "");
    if (phone.trim().length > 20 || !/^[0-9 +\-()]+$/.test(phone.trim()) || digits.length < 7) {
      errs.phone = "Enter a phone number with at least 7 digits";
    }
    if (email.trim() && !EMAIL_RE.test(email.trim())) errs.email = "That email doesn't look right";
    if (pay === "online" && !email.trim()) errs.email = "A payment link needs the customer's email";
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error("Check the highlighted fields");
      return;
    }

    attemptId.current ??= crypto.randomUUID();
    setSubmitting(true);
    setSubmitError(null);
    setShortages({});
    try {
      const order = await createAdminOrder({
        id: attemptId.current,
        items: orderItems(),
        customer: {
          name: name.trim(),
          phone: phone.trim(),
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        ...(d.value ? { delivery: d.value } : {}),
        paymentMethod: pay,
        ...(discount ? { discountCode: discount.code } : {}),
      });
      attemptId.current = null;
      setCreated(order);
      // The order took stock: refresh the shop's cache and this form's own list.
      loadProducts(true).catch(() => {});
      productList.reload().catch(() => {});
    } catch (err) {
      const refusal = (err as { body?: { code?: unknown } } | null)?.body?.code;
      if (err instanceof ApiError && err.status === 409 && (refusal === "discount_invalid" || refusal === "discount_minimum")) {
        // The code was refused and nothing was created: not a stock problem. A new id for the next attempt.
        attemptId.current = null;
        setApplied(null);
        setCodeError(err.message);
        setSubmitError("Discount code not applied. Remove it or try another.");
      } else if (err instanceof ApiError && err.status === 409) {
        const short = (err.body as { short?: StockShortfall[] } | undefined)?.short ?? [];
        // A short line is matched to its variant by product, size and colour.
        const byVariant: Record<string, StockShortfall> = {};
        for (const s of short) {
          const line = lines.find((l) => {
            const v = findVariant(l);
            return l.productId === s.productId && v?.size === s.size && v?.color === s.color;
          });
          if (line) byVariant[line.variantId] = s;
        }
        setShortages(byVariant);
        setSubmitError("Not enough stock for some items. Lower the quantities or remove them, then try again.");
        productList.reload().catch(() => {});
      } else if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        onApiError(err);
      } else {
        setSubmitError(err instanceof Error ? err.message : "Something went wrong");
        if (err instanceof ApiError && err.status === 503) setOnlinePayments(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    attemptId.current = null;
    setLines([]);
    setName("");
    setPhone("");
    setEmail("");
    setNote("");
    setAddress(EMPTY_ADDRESS);
    setLocker("");
    setPay("whatsapp");
    setErrors({});
    setSubmitError(null);
    setShortages({});
    setCodeInput("");
    setApplied(null);
    setCodeError("");
    setCheckingCode(false);
    setCreated(null);
  };

  if (created) return <OrderCreated order={created} onAnother={reset} />;

  const fieldError = (msg?: string) =>
    msg ? (
      <p role="alert" className="text-sm text-status-low mt-1">
        {msg}
      </p>
    ) : null;

  return (
    <div className="max-w-2xl">
      <h2 className="display h-mid mb-8">New order</h2>
      <form onSubmit={handleSubmit} noValidate className="space-y-10">
        {/* 1. Items */}
        <section aria-labelledby="no-items" className="space-y-4">
          <h3 id="no-items" className="micro text-b60">1. Items</h3>
          {productList.loading && productList.data.length === 0 && <p className="micro text-b60">Loading products…</p>}
          {productList.error && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-b60">Couldn't load products: {productList.error}</p>
              <Button type="button" variant="outline" onClick={() => productList.reload().catch(() => {})}>
                Retry
              </Button>
            </div>
          )}
          {!productList.error && <AdminOrderLinePicker products={products} onAdd={addLine} />}
          {fieldError(errors.lines)}

          {lines.length > 0 && (
            <ul className="border border-b10 r-card divide-y divide-b10" aria-label="Items in this order">
              {lines.map((l) => {
                const p = findProduct(l.productId);
                const v = findVariant(l);
                const short = shortages[l.variantId];
                const left = v?.stock ?? 0;
                const over = l.quantity > left;
                return (
                  <li key={l.variantId} className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-ink break-words">{p?.name ?? "Unknown product"}</div>
                        <div className="text-sm text-b60 break-words">{v ? variantLabel(v) : "Unknown variant"}</div>
                      </div>
                      <div className="text-ink shrink-0">R{((p?.price ?? 0) * l.quantity).toFixed(2)}</div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label={`One fewer ${p?.name ?? "item"}`}
                          onClick={() => setQuantity(l.variantId, l.quantity - 1)}
                          disabled={l.quantity <= 1}
                          className="size-10 md:size-9"
                        >
                          <Minus className="w-4 h-4" />
                        </Button>
                        <span className="text-ink w-8 text-center" aria-label="Quantity">
                          {l.quantity}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label={`One more ${p?.name ?? "item"}`}
                          onClick={() => setQuantity(l.variantId, l.quantity + 1)}
                          disabled={l.quantity >= MAX_LINE_QUANTITY}
                          className="size-10 md:size-9"
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(l.variantId)}
                        aria-label={`Remove ${p?.name ?? "item"}`}
                        className="p-2 text-ink hover:text-b60 transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                    {short ? (
                      <p role="alert" className="text-sm text-status-low">
                        Only {short.available} left, you asked for {short.requested}.
                      </p>
                    ) : (
                      <p className={`text-sm ${over || left <= 3 ? "text-status-low" : "text-b60"}`}>
                        {over ? `Only ${left} in stock, this is ${l.quantity}.` : `${left} in stock`}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 2. Customer */}
        <section aria-labelledby="no-customer" className="space-y-4">
          <h3 id="no-customer" className="micro text-b60">2. Customer</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="no-name">Name</Label>
              <Input id="no-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" className="mt-1 h-11 md:h-9" aria-invalid={!!errors.name} />
              {fieldError(errors.name)}
            </div>
            <div>
              <Label htmlFor="no-phone">Phone</Label>
              <Input id="no-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} placeholder="082 123 4567" autoComplete="off" className="mt-1 h-11 md:h-9" aria-invalid={!!errors.phone} />
              {fieldError(errors.phone)}
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="no-email">Email (optional{pay === "online" ? ", needed for the payment link" : ""})</Label>
              <Input id="no-email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="off" className="mt-1 h-11 md:h-9" aria-invalid={!!errors.email} />
              {fieldError(errors.email)}
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="no-note">Note (optional)</Label>
              <Textarea id="no-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="mt-1" />
            </div>
          </div>
        </section>

        {/* 3. Delivery */}
        <section aria-labelledby="no-delivery" className="space-y-4">
          <h3 id="no-delivery" className="micro text-b60">3. Delivery</h3>
          {delivery.loading && delivery.data.length === 0 && <p className="micro text-b60">Loading delivery options…</p>}
          {delivery.error && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-b60">Couldn't load delivery options. You can still create the order without delivery details.</p>
              <Button type="button" variant="outline" onClick={() => delivery.reload().catch(() => {})}>
                Retry
              </Button>
            </div>
          )}
          {delivery.data.length > 0 && (
            <div>
              <Label htmlFor="no-delivery-option">Delivery</Label>
              <Select value={deliveryId} onValueChange={setDeliveryId}>
                <SelectTrigger id="no-delivery-option" className="mt-1 h-11 md:h-9">
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {delivery.data.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name} — {d.price > 0 ? `R${d.price.toFixed(2)}` : "free"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {chosenDelivery?.id === "locker" && (
            <div>
              <Label htmlFor="no-locker">Locker name or code</Label>
              <Input id="no-locker" value={locker} onChange={(e) => setLocker(e.target.value)} maxLength={120} className="mt-1 h-11 md:h-9" aria-invalid={!!errors.locker} />
              {fieldError(errors.locker)}
            </div>
          )}
          {chosenDelivery?.id === "door" && (
            <fieldset className="grid gap-4 md:grid-cols-2">
              <legend className="sr-only">Delivery address</legend>
              <div className="md:col-span-2">
                <Label htmlFor="no-line1">Street address</Label>
                <Input id="no-line1" value={address.line1} onChange={(e) => setAddress({ ...address, line1: e.target.value })} maxLength={120} autoComplete="off" className="mt-1 h-11 md:h-9" />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="no-line2">Apartment, complex (optional)</Label>
                <Input id="no-line2" value={address.line2 ?? ""} onChange={(e) => setAddress({ ...address, line2: e.target.value })} maxLength={120} autoComplete="off" className="mt-1 h-11 md:h-9" />
              </div>
              <div>
                <Label htmlFor="no-suburb">Suburb</Label>
                <Input id="no-suburb" value={address.suburb} onChange={(e) => setAddress({ ...address, suburb: e.target.value })} maxLength={120} autoComplete="off" className="mt-1 h-11 md:h-9" />
              </div>
              <div>
                <Label htmlFor="no-city">City</Label>
                <Input id="no-city" value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} maxLength={120} autoComplete="off" className="mt-1 h-11 md:h-9" />
              </div>
              <div>
                <Label htmlFor="no-postal">Postal code</Label>
                <Input id="no-postal" inputMode="numeric" value={address.postalCode} onChange={(e) => setAddress({ ...address, postalCode: e.target.value })} maxLength={4} autoComplete="off" className="mt-1 h-11 md:h-9" />
              </div>
              {errors.address && <div className="md:col-span-2">{fieldError(errors.address)}</div>}
            </fieldset>
          )}
        </section>

        {/* 4. Payment */}
        <section aria-labelledby="no-payment" className="space-y-3">
          <h3 id="no-payment" className="micro text-b60">4. Payment</h3>
          <fieldset className="space-y-2">
            <legend className="sr-only">How the customer pays</legend>
            <label className="flex items-start gap-3 border border-b10 r-card p-3 cursor-pointer min-h-11">
              <input type="radio" name="pay" value="whatsapp" checked={pay === "whatsapp"} onChange={() => setPay("whatsapp")} className="mt-1 h-5 w-5 accent-brand" />
              <span>
                <span className="text-ink block">Customer pays on WhatsApp or cash</span>
                <span className="text-sm text-b60 block">The order waits as pending. Mark it paid in Orders once you have the money.</span>
              </span>
            </label>
            {onlinePayments && (
              <label className="flex items-start gap-3 border border-b10 r-card p-3 cursor-pointer min-h-11">
                <input type="radio" name="pay" value="online" checked={pay === "online"} onChange={() => setPay("online")} className="mt-1 h-5 w-5 accent-brand" />
                <span>
                  <span className="text-ink block">Send payment link</span>
                  <span className="text-sm text-b60 block">The customer pays online from their order link. Their stock is held for 48 hours. Needs their email.</span>
                </span>
              </label>
            )}
          </fieldset>
        </section>

        {/* Summary and submit */}
        <section className="border-t border-b10 pt-6 space-y-4">
          <div>
            <Label htmlFor="no-discount">Discount code (optional)</Label>
            {discount ? (
              <div className="mt-1 flex items-center justify-between gap-3 min-h-11 md:min-h-9">
                <span className="text-ink break-words">
                  {discount.code}: -{money(discount.amount)}
                </span>
                <Button type="button" variant="outline" onClick={handleRemoveCode} disabled={submitting} className="min-h-11 md:min-h-9">
                  Remove
                </Button>
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-2">
                <Input
                  id="no-discount"
                  value={codeInput}
                  maxLength={40}
                  autoCapitalize="characters"
                  autoComplete="off"
                  disabled={submitting || checkingCode}
                  aria-invalid={!!codeError || codeStale}
                  onChange={(e) => setCodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleApplyCode();
                    }
                  }}
                  className="h-11 md:h-9"
                />
                <Button type="button" variant="outline" onClick={() => void handleApplyCode()} disabled={submitting || checkingCode} className="min-h-11 md:min-h-9">
                  {checkingCode ? "Checking…" : "Apply"}
                </Button>
              </div>
            )}
            {!discount && fieldError(codeError || (codeStale ? "Check your code again" : ""))}
          </div>
          {discount && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="micro text-b60">Discount ({discount.code})</span>
              <span className="text-ink">-{money(discount.amount)}</span>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3">
            <span className="micro text-b60">Estimated total{chosenDelivery && chosenDelivery.price > 0 ? " (with delivery)" : ""}</span>
            <span className="text-ink text-xl">R{estimate.toFixed(2)}</span>
          </div>
          <p className="text-sm text-b60">The server sets the final prices and delivery fee.</p>
          {submitError && (
            <p role="alert" className="border border-status-low r-card p-3 text-sm text-ink">
              {submitError}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="w-full sm:w-auto min-h-11 md:min-h-9">
            {submitting ? "Creating…" : pay === "online" ? "Create order and payment link" : "Create order"}
          </Button>
        </section>
      </form>
    </div>
  );
}

/** What the owner sees once the order exists: its reference and total, the link, and a WhatsApp message to send. */
function OrderCreated({ order, onAnother }: { order: Order; onAnother: () => void }) {
  const link = orderLinkFor(order);
  const wa = whatsappUrlFor(order.customer.phone, buildOrderLinkMessage(order, link));
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(link);
      ok = true;
    } catch {
      // No clipboard API (an insecure page) or no permission: select the link and try the old way.
      (document.getElementById("order-link") as HTMLInputElement | null)?.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      toast.success("Order link copied");
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("Couldn't copy. Select the link and copy it by hand.");
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="display h-mid">Order created</h2>
      <div className="border border-b10 r-card p-4 md:p-6 space-y-4" role="status">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <span className="font-mono text-ink text-2xl">{order.ref}</span>
          <span className="text-ink text-2xl">R{order.total.toFixed(2)}</span>
        </div>
        {order.discountAmount != null && order.discountAmount > 0 && (
          <div className="text-sm text-ink">
            Discount{order.discountCode ? ` (${order.discountCode})` : ""}: -R{order.discountAmount.toFixed(2)}
          </div>
        )}
        <div className="text-ink">
          <div className="break-words">{order.customer.name} · {order.customer.phone}</div>
          <div className="text-sm text-b60">
            {order.status === "awaiting_payment"
              ? `Payment link ready. Stock held until ${order.expiresAt ? formatDate(order.expiresAt) : "payment"}.`
              : `Pending: the customer pays on WhatsApp or cash.${order.expiresAt ? ` It cancels itself on ${formatDate(order.expiresAt)} if unpaid.` : ""}`}
          </div>
        </div>
        <ul className="text-sm text-ink divide-y divide-b10 border-t border-b10">
          {order.lines.map((l, i) => (
            <li key={`${l.productId}-${i}`} className="py-2 break-words">
              {l.quantity} × {l.name}
              {l.size ? ` · ${l.size}` : ""}
              {l.color ? ` · ${l.color}` : ""}
            </li>
          ))}
        </ul>
        <div>
          <Label htmlFor="order-link">Order link</Label>
          <Input id="order-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="mt-1 h-11 md:h-9 text-sm" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void copy()} className="min-h-11 md:min-h-9">
            {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
            Copy order link
          </Button>
          {wa ? (
            <Button asChild className="min-h-11 md:min-h-9">
              <a href={wa} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="w-4 h-4 mr-2" />
                Send on WhatsApp
              </a>
            </Button>
          ) : (
            <p className="text-sm text-status-low self-center">That phone number can't be used for WhatsApp.</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <Button type="button" variant="outline" onClick={onAnother} className="min-h-11 md:min-h-9">
          <Plus className="w-4 h-4 mr-2" />
          Create another order
        </Button>
        <Link to={sectionHref("orders")} className="linkr text-ink self-center">
          Open Orders
        </Link>
      </div>
    </div>
  );
}
