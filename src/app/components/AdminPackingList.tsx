import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "./ui/button";
import type { Order } from "../api/types";
import { deliveryLabel } from "../utils/orderMessage";
import { addressLine } from "../utils/adminOrder";
import { saleTime } from "../utils/adminDashboard";

// While this view is open and the browser prints, everything outside it (the site header and footer, the admin
// shell and nav) is dropped from the layout, not just hidden, so no blank pages follow. The rule is here, not in
// the site CSS, so it exists only while the packing list does. Inside the view, Tailwind `print:` classes set the
// page look and hide the buttons.
const PRINT_ONLY_THIS = `
@media print {
  :not(:has([data-print-area]), [data-print-area], [data-print-area] *) { display: none !important; }
  html, body { height: auto !important; background: transparent !important; }
  @page { margin: 12mm; }
}`;

interface AdminPackingListProps {
  /** The paid orders to pack. The caller has already filtered, so nothing else can be printed. */
  orders: Order[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onClose: () => void;
}

const PACK_DATE = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short" });

/** A print-friendly list of every paid order: who it is for, where it goes and what goes in the parcel. */
export function AdminPackingList({ orders, loading, error, onRefresh, onClose }: AdminPackingListProps) {
  // Oldest payment first, so the longest-waiting parcel is packed first.
  const toPack = [...orders].sort((a, b) => saleTime(a) - saleTime(b));
  return (
    <div data-print-area>
      <style>{PRINT_ONLY_THIS}</style>
      <div className="flex flex-wrap justify-between items-center gap-4 mb-8 print:hidden">
        <Button variant="outline" onClick={onClose}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to orders
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onRefresh} disabled={loading}>
            Refresh
          </Button>
          <Button onClick={() => window.print()} disabled={toPack.length === 0}>
            <Printer className="w-4 h-4 mr-2" />
            Print
          </Button>
        </div>
      </div>

      <div className="mb-6 print:mb-4">
        <h2 className="display h-mid print:text-3xl">Packing list</h2>
        <p className="text-sm text-b60 mt-2 print:text-ink">
          {toPack.length} paid {toPack.length === 1 ? "order" : "orders"} to pack · {PACK_DATE.format(new Date())}
        </p>
      </div>

      {error && (
        <p className="border border-b10 r-card px-4 py-3 mb-4 text-b60 print:hidden">
          Couldn't refresh the orders: {error}. This list may be out of date.
        </p>
      )}
      {loading && toPack.length === 0 && <p className="micro text-b60 print:hidden">Loading orders…</p>}
      {!loading && toPack.length === 0 && <p className="text-b60">Nothing to pack: no paid orders.</p>}

      <ol className="space-y-4 print:space-y-3">
        {toPack.map((order) => {
          const address = addressLine(order.delivery);
          return (
            <li key={order.id} className="border border-b10 r-card p-4 break-inside-avoid print:border-ink print:p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="font-mono text-ink text-lg">{order.ref}</span>
                <span className="text-ink break-words">{order.customer.name}</span>
              </div>
              <div className="text-ink text-sm mt-1">{order.customer.phone}</div>
              <div className="mt-2 text-ink">
                <span className="micro text-b60">Deliver: </span>
                {order.delivery ? deliveryLabel(order.delivery.method) : "No delivery details"}
                {order.delivery?.locker && <span className="break-words"> · {order.delivery.locker}</span>}
                {address && <div className="break-words">{address}</div>}
              </div>
              {order.customer.note && (
                <div className="mt-1 text-sm text-b60 print:text-ink break-words">Note: {order.customer.note}</div>
              )}
              <ul className="mt-3 divide-y divide-b10 border-t border-b10 print:divide-ink print:border-ink">
                {order.lines.map((line, i) => (
                  <li key={`${line.productId}-${i}`} className="py-2 flex items-start gap-3">
                    <span aria-hidden="true" className="mt-1 inline-block h-4 w-4 shrink-0 border border-ink" />
                    <div className="min-w-0 text-ink">
                      <div className="break-words">
                        <span>{line.quantity} ×</span> {line.name}
                      </div>
                      <div className="text-sm text-b60 print:text-ink break-words">
                        Size {line.size || "—"} · Colour {line.color || "—"} · SKU{" "}
                        <span className="font-mono">{line.sku || "—"}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
