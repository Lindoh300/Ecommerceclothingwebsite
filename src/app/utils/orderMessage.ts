import type { Order } from '../api/types'

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

  message += `Total: R${order.total.toFixed(2)}`;
  if (order.customer.note) message += `\n\nNote: ${order.customer.note}`;
  return message;
}
