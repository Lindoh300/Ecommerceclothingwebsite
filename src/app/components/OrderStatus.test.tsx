// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { OrderStatus } from "./OrderStatus";
import { getPublicOrder } from "../api/orders";
import type { PublicOrder } from "../api/types";

vi.mock("../api/orders", () => ({ getPublicOrder: vi.fn(), payOrder: vi.fn() }));
vi.mock("../lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function makeOrder(over: Partial<PublicOrder> = {}): PublicOrder {
  return {
    id: "ord-1",
    ref: "4N-1042",
    createdAt: "2026-10-31T10:00:00Z",
    status: "pending",
    lines: [{ name: "Classic Tee", size: "M", color: "Black", quantity: 2, subtotal: 600 }],
    deliveryFee: 60,
    total: 610,
    delivery: { method: "door" },
    tracking: null,
    expiresAt: null,
    paymentMethod: "whatsapp",
    ...over,
  };
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/order/ord-1"]}>
      <Routes>
        <Route path="/order/:id" element={<OrderStatus />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The amount beside a label in the money summary (the span, not the "Items" heading elsewhere on the page). */
const rowValue = (label: string) => screen.getByText(label, { selector: "span" }).nextElementSibling;

beforeEach(() => {
  vi.mocked(getPublicOrder).mockReset();
});

describe("OrderStatus money summary", () => {
  it("shows the discount line, the items before it and the net total", async () => {
    vi.mocked(getPublicOrder).mockResolvedValue(makeOrder({ discountCode: "SAVE50", discountAmount: 50 }));
    renderPage();

    expect(await screen.findByText("Discount (SAVE50)")).toBeInTheDocument();
    expect(screen.getByText("-R50.00")).toBeInTheDocument();
    // total 610 = items 600 - discount 50 + delivery 60
    expect(rowValue("Items")).toHaveTextContent("R600.00");
    expect(rowValue("Total")).toHaveTextContent("R610.00");
  });

  it("has no discount line when there is no discount", async () => {
    vi.mocked(getPublicOrder).mockResolvedValue(makeOrder({ total: 660, discountCode: null, discountAmount: 0 }));
    renderPage();

    expect(await screen.findByText("Total")).toBeInTheDocument();
    expect(screen.queryByText(/^Discount/)).not.toBeInTheDocument();
    expect(rowValue("Items")).toHaveTextContent("R600.00");
  });

  it("treats an order from an older server (no discount fields) as undiscounted", async () => {
    vi.mocked(getPublicOrder).mockResolvedValue(makeOrder({ total: 660 }));
    renderPage();

    expect(await screen.findByText("Total")).toBeInTheDocument();
    expect(screen.queryByText(/^Discount/)).not.toBeInTheDocument();
    expect(rowValue("Items")).toHaveTextContent("R600.00");
  });
});
