import type { Order } from '../api/types'

const DELIVERY_LABELS: Record<string, string> = { door: 'Door delivery', locker: 'Locker', collect: 'Collect' }

export const deliveryLabel = (method: string): string => DELIVERY_LABELS[method] ?? method

export function buildOrderMessage(order: Order): string {
  let message = `Hi! I've placed order ${order.ref}.\n`;
  message += `Name: ${order.customer.name}\n\n`;

  order.lines.forEach((line, index) => {
    message += `${index + 1}. ${line.name}\n`;
    if (line.size) message += `   - Size: ${line.size}\n`;
    if (line.color) message += `   - Color: ${line.color}\n`;
    message += `   - Qty: ${line.quantity}\n`;
    message += `   - Price: R${line.price}\n`;
    message += `   - Subtotal: R${line.subtotal}\n\n`;
  });

  const d = order.delivery;
  if (d) {
    message += `Delivery: ${deliveryLabel(d.method)}\n`;
    if (d.address) {
      const a = d.address;
      message += `Address: ${[a.line1, a.line2, a.suburb, a.city, a.postalCode].filter(Boolean).join(', ')}\n`;
    }
    if (d.locker) message += `Locker: ${d.locker}\n`;
    message += `Delivery fee: R${d.fee.toFixed(2)}\n\n`;
  }

  message += `Total: R${order.total.toFixed(2)}`;
  if (order.customer.note) message += `\n\nNote: ${order.customer.note}`;
  return message;
}
