import { useId, useMemo, useState } from "react";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { listCustomers } from "../api/customersAdmin";
import type { CustomerSummary } from "../api/types";
import { useAdminList } from "../hooks/useAdminList";
import { whatsappUrlFor } from "../utils/adminOrder";
import { shop } from "../config/shop";
import type { AdminSectionProps } from "./adminSections";

const formatDate = (iso: string): string => new Date(iso).toLocaleDateString("en-ZA", { dateStyle: "medium" });

/** The opening WhatsApp message to a customer: their first name and the shop name. */
function greetingFor(customer: CustomerSummary): string {
  const first = customer.name.trim().split(/\s+/)[0] || "there";
  return `Hi ${first}, this is ${shop.name} here.`;
}

/** Opens WhatsApp with a greeting for the customer. Renders nothing when the number is unusable. */
function MessageLink({ customer }: { customer: CustomerSummary }) {
  const href = whatsappUrlFor(customer.phone, greetingFor(customer));
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="linkr text-ink min-h-11 inline-flex items-center">
      Message on WhatsApp
    </a>
  );
}

/**
 * Whether a customer matches the search. Name and email match text, case-insensitively. Phone matches on digits
 * only, so "082 123" finds "082 123 4567" and "+27 82" finds "+27 82 123 4567". Text with letters never matches on phone.
 */
export function matchesCustomer(customer: CustomerSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  if (customer.name.toLowerCase().includes(q)) return true;
  if (customer.email?.toLowerCase().includes(q)) return true;
  if (/^[\d\s+()-]+$/.test(q)) {
    const digits = q.replace(/\D/g, "");
    if (digits !== "" && customer.phone.replace(/\D/g, "").includes(digits)) return true;
  }
  return false;
}

function CustomerCard({ customer }: { customer: CustomerSummary }) {
  return (
    <div className="border border-b10 r-card p-4 md:p-6 flex flex-col gap-2">
      <div className="flex flex-wrap justify-between items-baseline gap-x-4 gap-y-1">
        <h3 className="h-weight text-ink break-words min-w-0">{customer.name}</h3>
        {customer.subscribed && <span className="micro text-b60">On the list</span>}
      </div>
      <p className="text-ink break-all">{customer.phone}</p>
      {customer.email && <p className="text-b60 break-all">{customer.email}</p>}
      <p className="text-sm text-b60">
        {customer.orders === 1 ? "1 order" : `${customer.orders} orders`} · Spent R{customer.spent.toFixed(2)}
      </p>
      <p className="text-sm text-b60">Last order {formatDate(customer.lastOrderAt)}</p>
      <MessageLink customer={customer} />
    </div>
  );
}

/** The Customers section: everyone who has ordered, with a search. Read only. */
export function AdminCustomers({ onApiError }: AdminSectionProps) {
  const searchId = useId();
  const customers = useAdminList(() => listCustomers(), onApiError);
  const [search, setSearch] = useState("");

  const shown = useMemo(
    () => customers.data.filter((c) => matchesCustomer(c, search)),
    [customers.data, search],
  );

  const hasCustomers = customers.data.length > 0;

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <h2 className="display h-mid">Customers</h2>
      </div>

      {customers.loading && !hasCustomers && <p className="micro text-b60">Loading customers…</p>}
      {customers.error && <p className="text-b60">Couldn't load customers: {customers.error}</p>}

      {!customers.loading && !customers.error && !hasCustomers && <p className="text-b60">No customers yet.</p>}

      {hasCustomers && (
        <>
          <div className="mb-6">
            <Label htmlFor={searchId}>Search customers</Label>
            <Input
              id={searchId}
              type="search"
              value={search}
              placeholder="Name, phone or email"
              onChange={(e) => setSearch(e.target.value)}
              className="w-full"
            />
          </div>

          <p className="text-sm text-b60 mb-4">
            {shown.length === 1 ? "1 customer" : `${shown.length} customers`}
          </p>

          {shown.length === 0 ? (
            <p className="text-b60">No customers match.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {shown.map((c) => (
                <CustomerCard key={c.phone} customer={c} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
