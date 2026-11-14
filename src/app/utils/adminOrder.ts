import type { Order, OrderDelivery, OrderStatus } from "../api/types";

// Small helpers the admin order screens share: how an address reads, the WhatsApp number and the message that
// goes with a new order's link.

/** One line for a door address; '' when there is none. */
export function addressLine(delivery: OrderDelivery | null | undefined): string {
  const a = delivery?.address;
  if (!a) return "";
  return [a.line1, a.line2, a.suburb, a.city, a.postalCode].filter(Boolean).join(", ");
}

/**
 * A phone number as wa.me wants it: international, digits only. A leading 0 becomes 27 (South Africa), a leading
 * + or 00 is dropped, and a stray (0) after +27 is dropped. A South African mobile written with the leading 0 left
 * off (9 digits starting 6, 7 or 8, with no + or 00) gets 27 in front. Returns '' when there are fewer than 7 digits left.
 */
export function toWhatsAppNumber(phone: string): string {
  const trimmed = phone.trim();
  let digits = phone.replace(/\D/g, "");
  if (trimmed.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("270")) digits = `27${digits.slice(3)}`;
  else if (digits.startsWith("0")) digits = `27${digits.slice(1)}`;
  else if (digits.length === 9 && /^[678]/.test(digits) && !trimmed.startsWith("+")) digits = `27${digits}`;
  return digits.length >= 7 ? digits : "";
}

/** The short message that goes to the customer with the link to their order. */
export function buildOrderLinkMessage(order: Order, orderUrl: string): string {
  const first = order.customer.name.trim().split(/\s+/)[0] || "there";
  const pay = order.status === "awaiting_payment";
  return (
    `Hi ${first}, your 4Nguru order ${order.ref} is ready (total R${order.total.toFixed(2)}).\n` +
    `${pay ? "Pay securely and see your order here" : "See your order here"}: ${orderUrl}`
  );
}

/** The status sentence after "Hi <first>, ". Record, so a new status is a type error until it has text. */
const STATUS_UPDATE: Record<OrderStatus, (order: Order) => string> = {
  pending: (o) => `your 4Nguru order ${o.ref} is waiting for payment (total R${o.total.toFixed(2)}).`,
  awaiting_payment: (o) => `your 4Nguru order ${o.ref} is waiting for payment (total R${o.total.toFixed(2)}).`,
  paid: (o) => `we have received your payment for 4Nguru order ${o.ref}. Thank you.`,
  packed: (o) => `your 4Nguru order ${o.ref} is packed.`,
  shipped: (o) => `your 4Nguru order ${o.ref} has shipped.`,
  delivered: (o) => `your 4Nguru order ${o.ref} has been delivered. Thank you for shopping with us.`,
  cancelled: (o) => `your 4Nguru order ${o.ref} has been cancelled.`,
  expired: (o) => `your 4Nguru order ${o.ref} expired before it was paid.`,
  refunded: (o) => `your 4Nguru order ${o.ref} has been refunded.`,
};

/** The status update the owner sends from WhatsApp. Names, prices and links only: no address or note. */
export function buildOrderUpdateMessage(order: Order, orderUrl: string): string {
  const first = order.customer.name.trim().split(/\s+/)[0] || "there";
  const lines = [`Hi ${first}, ${STATUS_UPDATE[order.status](order)}`];
  if (order.status === "shipped" && order.tracking) {
    const { courier, number, url } = order.tracking;
    if (courier) lines.push(`Courier: ${courier}`);
    if (number) lines.push(`Tracking number: ${number}`);
    if (url) lines.push(`Track your parcel: ${url}`);
  }
  lines.push(`See your order here: ${orderUrl}`);
  return lines.join("\n");
}

/** wa.me link to a customer's number with a message, or null when the number is no good. */
export function whatsappUrlFor(phone: string, text: string): string | null {
  const to = toWhatsAppNumber(phone);
  return to ? `https://wa.me/${to}?text=${encodeURIComponent(text)}` : null;
}
