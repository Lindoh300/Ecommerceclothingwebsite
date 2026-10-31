import type { Order, OrderDelivery } from "../api/types";

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
 * + or 00 is dropped, and a stray (0) after +27 is dropped. Returns '' when there are fewer than 7 digits left.
 */
export function toWhatsAppNumber(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (phone.trim().startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("270")) digits = `27${digits.slice(3)}`;
  else if (digits.startsWith("0")) digits = `27${digits.slice(1)}`;
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

/** wa.me link to a customer's number with a message, or null when the number is no good. */
export function whatsappUrlFor(phone: string, text: string): string | null {
  const to = toWhatsAppNumber(phone);
  return to ? `https://wa.me/${to}?text=${encodeURIComponent(text)}` : null;
}
