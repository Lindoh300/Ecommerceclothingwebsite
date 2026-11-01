// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AdminOrders } from "./AdminOrders";
import { listOrders } from "../api/orders";
import { useMediaQuery } from "../hooks/useMediaQuery";
import type { Order } from "../api/types";

vi.mock("../api/orders", () => ({
  cancelOrder: vi.fn(),
  extendOrder: vi.fn(),
  listOrders: vi.fn(),
  markOrderPaid: vi.fn(),
  setOrderStatus: vi.fn(),
  setOrderTracking: vi.fn(),
}));
vi.mock("../lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("../hooks/useProducts", () => ({ loadProducts: vi.fn() }));
vi.mock("../hooks/useMediaQuery", () => ({ useMediaQuery: vi.fn() }));

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: "o1",
    ref: "4N-1042",
    createdAt: "2026-10-31T10:00:00Z",
    status: "pending",
    lines: [{ productId: "p1", name: "Classic Tee", price: 300, size: "M", color: "Black", quantity: 2, subtotal: 600 }],
    total: 550,
    customer: { name: "Thandi Nkosi", phone: "082 123 4567" },
    ...over,
  };
}

function renderOrders(order: Order, desktop: boolean) {
  vi.mocked(useMediaQuery).mockReturnValue(desktop);
  vi.mocked(listOrders).mockResolvedValue([order]);
  render(
    <MemoryRouter>
      <AdminOrders onApiError={vi.fn()} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(listOrders).mockReset();
  vi.mocked(useMediaQuery).mockReset();
});

describe.each([
  ["table (desktop)", true],
  ["card (phone)", false],
])("discount line in the %s", (_name, desktop) => {
  it("shows Discount (CODE) -R50.00 when there is a discount", async () => {
    renderOrders(makeOrder({ discountCode: "SAVE50", discountAmount: 50 }), desktop);
    await screen.findByText("4N-1042");
    expect(screen.getByText(/Discount \(SAVE50\)/)).toBeInTheDocument();
    expect(screen.getByText(/-R50\.00/)).toBeInTheDocument();
    expect(screen.getByText("R550.00")).toBeInTheDocument();
    if (desktop) {
      const cell = screen.getByText("R550.00").closest("td")!;
      expect(within(cell).getByText(/Discount \(SAVE50\)/)).toHaveTextContent("Discount (SAVE50) -R50.00");
    }
  });

  it("shows no discount line without one", async () => {
    renderOrders(makeOrder({ discountCode: null, discountAmount: 0 }), desktop);
    await screen.findByText("4N-1042");
    expect(screen.queryByText(/Discount/)).not.toBeInTheDocument();
  });
});
