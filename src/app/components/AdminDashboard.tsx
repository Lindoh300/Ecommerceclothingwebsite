import { useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "./ui/button";
import { listOrders } from "../api/orders";
import { listAllProducts } from "../api/products";
import type { Order } from "../api/types";
import { useAdminList, type AdminList } from "../hooks/useAdminList";
import {
  dashboardOrders,
  EXPIRING_WITHIN_HOURS,
  LOW_STOCK_AT,
  lowStockVariants,
  type SalesTotal,
} from "../utils/adminDashboard";
import { sectionHref, type AdminSectionProps } from "./adminSections";

// A block shows at most this many rows; the link under it goes to the full list.
const SHOWN = 5;

const formatWhen = (iso: string): string =>
  new Date(iso).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });

interface BlockProps {
  title: string;
  /** The big number, or text. */
  figure: ReactNode;
  /** Where "View all" goes. */
  href: string;
  linkLabel: string;
  children?: ReactNode;
}

function Block({ title, figure, href, linkLabel, children }: BlockProps) {
  return (
    <section aria-label={title} className="border border-b10 r-card p-4 md:p-6 flex flex-col gap-3 min-w-0">
      <h3 className="micro text-b60">{title}</h3>
      <div className="display h-mid text-ink">{figure}</div>
      <div className="grow min-w-0">{children}</div>
      <Link to={href} className="linkr text-ink self-start">
        {linkLabel}
      </Link>
    </section>
  );
}

/** Shown in place of a block's rows while its list is loading or could not load. */
function ListStatus({ list, what }: { list: AdminList<unknown>; what: string }) {
  if (list.error) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-b60 text-sm">Couldn't load {what}: {list.error}</p>
        <Button variant="outline" size="sm" onClick={() => list.reload().catch(() => {})}>
          Retry
        </Button>
      </div>
    );
  }
  return <p className="micro text-b60">Loading…</p>;
}

function OrderRows({ orders, extra }: { orders: Order[]; extra: (o: Order) => ReactNode }) {
  const more = orders.length - SHOWN;
  return (
    <ul className="divide-y divide-b10">
      {orders.slice(0, SHOWN).map((o) => (
        <li key={o.id} className="py-2 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
          <span className="min-w-0">
            <span className="font-mono text-ink">{o.ref}</span>
            <span className="text-ink break-words"> · {o.customer.name}</span>
          </span>
          <span className="text-b60">{extra(o)}</span>
        </li>
      ))}
      {more > 0 && <li className="py-2 text-sm text-b60">and {more} more</li>}
    </ul>
  );
}

const rand = (n: number): string => `R${n.toFixed(2)}`;

function SalesBlock({ title, sales, since }: { title: string; sales: SalesTotal; since: string }) {
  return (
    <Block title={title} figure={rand(sales.total)} href={sectionHref("orders")} linkLabel="Open orders">
      <p className="text-b60 text-sm">
        {sales.count === 0
          ? `No paid orders ${since}.`
          : `${sales.count} paid ${sales.count === 1 ? "order" : "orders"} ${since}, delivery included.`}
      </p>
    </Block>
  );
}

/** The Dashboard section: what needs doing now, worked out in the browser from the order and product lists. */
export function AdminDashboard({ onApiError }: AdminSectionProps) {
  const orders = useAdminList(listOrders, onApiError);
  const products = useAdminList(listAllProducts, onApiError);
  const refreshing = orders.loading || products.loading;

  // Recomputed when a list loads; "now" is the moment of that load, in the viewer's own time zone.
  const figures = useMemo(() => dashboardOrders(orders.data, new Date()), [orders.data]);
  const low = useMemo(() => lowStockVariants(products.data), [products.data]);
  // While a list reloads, the figures from the last load stay on screen.
  const ordersReady = !orders.error && !(orders.loading && orders.data.length === 0);
  const productsReady = !products.error && !(products.loading && products.data.length === 0);

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
        <h2 className="display h-mid">Dashboard</h2>
        <Button
          variant="outline"
          disabled={refreshing}
          onClick={() => {
            orders.reload().catch(() => {});
            products.reload().catch(() => {});
          }}
        >
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Block
          title="Orders to pack"
          figure={ordersReady ? figures.toPack.length : "–"}
          href={sectionHref("orders", { filter: "to_pack" })}
          linkLabel="Open to-pack orders"
        >
          {!ordersReady ? (
            <ListStatus list={orders} what="orders" />
          ) : figures.toPack.length === 0 ? (
            <p className="text-b60 text-sm">Nothing to pack right now.</p>
          ) : (
            <OrderRows orders={figures.toPack} extra={(o) => `R${o.total.toFixed(2)}`} />
          )}
        </Block>

        <Block
          title={`Unpaid, expiring within ${EXPIRING_WITHIN_HOURS} hours`}
          figure={ordersReady ? figures.expiringSoon.length : "–"}
          href={sectionHref("orders", { filter: "pending" })}
          linkLabel="Open unpaid orders"
        >
          {!ordersReady ? (
            <ListStatus list={orders} what="orders" />
          ) : figures.expiringSoon.length === 0 ? (
            <p className="text-b60 text-sm">No unpaid order is about to expire.</p>
          ) : (
            <OrderRows orders={figures.expiringSoon} extra={(o) => formatWhen(o.expiresAt!)} />
          )}
        </Block>

        <Block
          title="Refund due or amount mismatch"
          figure={ordersReady ? figures.flagged.length : "–"}
          href={sectionHref("orders", { filter: "all" })}
          linkLabel="Open orders"
        >
          {!ordersReady ? (
            <ListStatus list={orders} what="orders" />
          ) : figures.flagged.length === 0 ? (
            <p className="text-b60 text-sm">No payment needs a check.</p>
          ) : (
            <OrderRows
              orders={figures.flagged}
              extra={(o) => (o.paymentFlag === "refund_due" ? "Refund due" : "Amount mismatch")}
            />
          )}
        </Block>

        {ordersReady ? (
          <>
            <SalesBlock title="Today's sales" sales={figures.today} since="today" />
            <SalesBlock title="This week's sales" sales={figures.week} since="since Monday" />
          </>
        ) : (
          <>
            <Block title="Today's sales" figure="–" href={sectionHref("orders")} linkLabel="Open orders">
              <ListStatus list={orders} what="orders" />
            </Block>
            <Block title="This week's sales" figure="–" href={sectionHref("orders")} linkLabel="Open orders">
              <ListStatus list={orders} what="orders" />
            </Block>
          </>
        )}

        <Block
          title={`Low stock (${LOW_STOCK_AT} or fewer)`}
          figure={productsReady ? low.length : "–"}
          href={sectionHref("products")}
          linkLabel="Open products"
        >
          {!productsReady ? (
            <ListStatus list={products} what="products" />
          ) : low.length === 0 ? (
            <p className="text-b60 text-sm">Every active product has enough stock.</p>
          ) : (
            <ul className="divide-y divide-b10">
              {low.slice(0, SHOWN).map((v) => (
                <li key={v.variantId} className="py-2 flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 text-ink break-words">
                    {v.productName}
                    <span className="text-b60">
                      {[v.size, v.color].filter(Boolean).length > 0 ? ` · ${[v.size, v.color].filter(Boolean).join(" ")}` : ""}
                    </span>
                  </span>
                  <span className={`shrink-0 ${v.stock === 0 ? "text-status-low" : "text-ink"}`}>
                    {v.stock === 0 ? "out" : `${v.stock} left`}
                  </span>
                </li>
              ))}
              {low.length > SHOWN && <li className="py-2 text-sm text-b60">and {low.length - SHOWN} more</li>}
            </ul>
          )}
        </Block>
      </div>
    </div>
  );
}
