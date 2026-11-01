// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { CheckoutPanel } from "./CheckoutPanel";
import { checkDiscountCode, getShopConfig, listDeliveryOptions, payOrder, placeOrder } from "../api/orders";
import type { DeliveryOption, Order } from "../api/types";
import { ApiError } from "../api/client";
import { toast } from "../lib/toast";
import { shop } from "../config/shop";

// Typing every field with userEvent is slow in jsdom.
vi.setConfig({ testTimeout: 20000 });

vi.mock("../api/orders", () => ({
  checkDiscountCode: vi.fn(),
  getShopConfig: vi.fn(),
  listDeliveryOptions: vi.fn(),
  payOrder: vi.fn(),
  placeOrder: vi.fn(),
}));
vi.mock("../lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const ITEMS = [{ productId: "p1", size: "M", color: "Black", quantity: 2 }];
const OPTIONS: DeliveryOption[] = [
  { id: "door", name: "Door delivery", price: 60 },
  { id: "locker", name: "Locker", price: 45 },
  { id: "collect", name: "Collect", price: 0 },
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    ref: "4N-1042",
    createdAt: "2026-10-31T10:00:00Z",
    status: "pending",
    lines: [{ productId: "p1", name: "Classic Tee", price: 300, size: "M", color: "Black", quantity: 2, subtotal: 600 }],
    total: 1234.5,
    customer: { name: "Thandi Nkosi", phone: "082 123 4567" },
    ...over,
  };
}

type Handlers = { onStockShort: () => void; onCartCleared: () => void; onOrderChange: (placed: boolean) => void };

function renderPanel(props: { itemsTotal?: number } = {}) {
  const handlers: Handlers = { onStockShort: vi.fn(), onCartCleared: vi.fn(), onOrderChange: vi.fn() };
  render(
    <MemoryRouter initialEntries={["/checkout"]}>
      <Routes>
        <Route
          path="/checkout"
          element={<CheckoutPanel items={ITEMS} blocked={false} itemsTotal={props.itemsTotal ?? 600} {...handlers} />}
        />
        <Route path="/order/:id" element={<p>Order page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return handlers;
}

const placeButton = () => screen.getByRole("button", { name: /^Place order/ });

async function fillContact(user: ReturnType<typeof userEvent.setup>, name = "Thandi Nkosi", phone = "082 123 4567") {
  await user.type(screen.getByLabelText("Name"), name);
  await user.type(screen.getByLabelText("Phone"), phone);
}

/** Waits for the delivery options to load, which also enables the Place order button. */
async function optionsLoaded() {
  await screen.findByRole("radio", { name: /Door delivery/ });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.mocked(listDeliveryOptions).mockReset().mockResolvedValue(OPTIONS);
  vi.mocked(getShopConfig).mockReset().mockResolvedValue({ onlinePayments: false });
  vi.mocked(checkDiscountCode).mockReset();
  vi.mocked(placeOrder).mockReset();
  vi.mocked(payOrder).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.success).mockReset();
});

describe("required details", () => {
  it("sends nothing until name and phone are filled", async () => {
    const user = userEvent.setup();
    renderPanel();
    await optionsLoaded();

    await user.click(placeButton());
    expect(placeOrder).not.toHaveBeenCalled();
    expect(screen.getByText("Enter your name (up to 80 characters)")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid phone number (at least 7 digits)")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("Check your details", { description: "Enter your name (up to 80 characters)" });

    await user.type(screen.getByLabelText("Name"), "Thandi");
    await user.type(screen.getByLabelText("Phone"), "abc");
    await user.click(placeButton());
    expect(placeOrder).not.toHaveBeenCalled();
    expect(screen.queryByText("Enter your name (up to 80 characters)")).not.toBeInTheDocument();
    expect(screen.getByText("Enter a valid phone number (at least 7 digits)")).toBeInTheDocument();
  });

  it("asks for a delivery choice when options exist", async () => {
    const user = userEvent.setup();
    renderPanel();
    await optionsLoaded();
    await fillContact(user);

    await user.click(placeButton());
    expect(placeOrder).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose how you want to receive your order");
  });

  it("needs a full address for door delivery", async () => {
    const user = userEvent.setup();
    renderPanel();
    await optionsLoaded();
    await fillContact(user);
    await user.click(screen.getByRole("radio", { name: /Door delivery/ }));

    await user.click(placeButton());
    expect(placeOrder).not.toHaveBeenCalled();
    expect(screen.getByText("Enter your street address")).toBeInTheDocument();
    expect(screen.getByText("Enter your suburb")).toBeInTheDocument();
    expect(screen.getByText("Enter your city")).toBeInTheDocument();
    expect(screen.getByText("Enter a 4 digit postal code")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Street address"), "12 Main Road");
    await user.type(screen.getByLabelText("Suburb"), "Sunnyside");
    await user.type(screen.getByLabelText("City"), "Pretoria");
    await user.type(screen.getByLabelText("Postal code"), "12");
    await user.click(placeButton());
    expect(placeOrder).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a 4 digit postal code")).toBeInTheDocument();
  });

  it("sends the trimmed door address once it is complete", async () => {
    const user = userEvent.setup();
    vi.mocked(placeOrder).mockResolvedValue(makeOrder());
    renderPanel();
    await optionsLoaded();
    await fillContact(user, "  Thandi Nkosi ", " 082 123 4567 ");
    await user.click(screen.getByRole("radio", { name: /Door delivery/ }));
    await user.type(screen.getByLabelText("Street address"), " 12 Main Road ");
    await user.type(screen.getByLabelText("Suburb"), "Sunnyside");
    await user.type(screen.getByLabelText("City"), "Pretoria");
    await user.type(screen.getByLabelText("Postal code"), "0002");
    await user.click(placeButton());

    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(placeOrder).toHaveBeenCalledWith({
      id: expect.stringMatching(UUID_RE),
      items: ITEMS,
      customer: { name: "Thandi Nkosi", phone: "082 123 4567" },
      delivery: {
        method: "door",
        address: { line1: "12 Main Road", suburb: "Sunnyside", city: "Pretoria", postalCode: "0002" },
      },
      paymentMethod: "whatsapp",
    });
  });

  it("needs a locker name or code for locker delivery", async () => {
    const user = userEvent.setup();
    vi.mocked(placeOrder).mockResolvedValue(makeOrder());
    renderPanel();
    await optionsLoaded();
    await fillContact(user);
    await user.click(screen.getByRole("radio", { name: /Locker/ }));

    await user.click(placeButton());
    expect(placeOrder).not.toHaveBeenCalled();
    expect(screen.getByText("Enter the locker name or code")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Locker name or code"), "  PG-4521 ");
    await user.click(placeButton());
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(vi.mocked(placeOrder).mock.calls[0][0].delivery).toEqual({ method: "locker", locker: "PG-4521" });
  });
});

describe("delivery options", () => {
  it("lists the options and prices from the API", async () => {
    renderPanel();
    await optionsLoaded();
    expect(listDeliveryOptions).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("radio", { name: /Door delivery/ })).toHaveAccessibleName(/R60\.00/);
    expect(screen.getByRole("radio", { name: /Locker/ })).toHaveAccessibleName(/R45\.00/);
    expect(screen.getByRole("radio", { name: /Collect/ })).toHaveAccessibleName(/Free/);
  });

  it("shows the estimated total as items plus the chosen delivery price", async () => {
    const user = userEvent.setup();
    renderPanel({ itemsTotal: 600 });
    await optionsLoaded();
    await user.click(screen.getByRole("radio", { name: /Door delivery/ }));
    expect(screen.getByText("R660.00")).toBeInTheDocument();
  });

  it("lets the customer order without delivery when the options fail to load", async () => {
    const user = userEvent.setup();
    vi.mocked(listDeliveryOptions).mockRejectedValue(new ApiError(500, "boom"));
    vi.mocked(placeOrder).mockResolvedValue(makeOrder());
    renderPanel();

    expect(await screen.findByText(/Delivery options could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Door delivery/ })).not.toBeInTheDocument();
    await fillContact(user);
    await user.click(placeButton());

    expect(placeOrder).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(placeOrder).mock.calls[0][0];
    expect(sent).not.toHaveProperty("delivery");
    expect(sent.customer).toEqual({ name: "Thandi Nkosi", phone: "082 123 4567" });
    expect(await screen.findByText("Order 4N-1042 saved")).toBeInTheDocument();
  });
});

describe("delivery options that fail or arrive late", () => {
  it("shows the options and drops the failure notice when the list arrives after the timeout", async () => {
    vi.useFakeTimers();
    try {
      const late = deferred<DeliveryOption[]>();
      vi.mocked(listDeliveryOptions).mockReturnValue(late.promise);
      renderPanel();

      // The 8 second timeout (OPTIONS_TIMEOUT_MS) gives up on the list.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });
      expect(screen.getByText(/Delivery options could not be loaded/)).toBeInTheDocument();

      await act(async () => {
        late.resolve(OPTIONS);
      });
      expect(screen.getByRole("radio", { name: /Door delivery/ })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /Locker/ })).toBeInTheDocument();
      expect(screen.queryByText(/Delivery options could not be loaded/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not offer Pay online while the options have failed, even with online payments on", async () => {
    vi.mocked(getShopConfig).mockResolvedValue({ onlinePayments: true });
    vi.mocked(listDeliveryOptions).mockRejectedValue(new ApiError(500, "boom"));
    renderPanel();

    await screen.findByText(/Delivery options could not be loaded/);
    // Let the shop config answer land before checking that Pay online is absent.
    await act(async () => {});
    expect(screen.getByRole("radio", { name: /Pay on WhatsApp/ })).toBeChecked();
    expect(screen.queryByRole("radio", { name: /Pay online/ })).not.toBeInTheDocument();
  });

  it("falls back to WhatsApp when the options fail after Pay online was chosen, and sends no delivery", async () => {
    const user = userEvent.setup();
    vi.mocked(getShopConfig).mockResolvedValue({ onlinePayments: true });
    // The first load works; the reload after "Unknown delivery option" fails.
    vi.mocked(listDeliveryOptions)
      .mockResolvedValueOnce(OPTIONS)
      .mockRejectedValueOnce(new ApiError(500, "boom"));
    vi.mocked(placeOrder)
      .mockRejectedValueOnce(new ApiError(400, "Unknown delivery option"))
      .mockResolvedValueOnce(makeOrder());
    renderPanel();

    await optionsLoaded();
    await fillContact(user);
    await user.click(screen.getByRole("radio", { name: /Collect/ }));
    await user.click(await screen.findByRole("radio", { name: /Pay online/ }));
    await user.type(screen.getByLabelText("Email"), "thandi@example.com");
    await user.click(screen.getByRole("button", { name: "Place order and pay" }));

    expect(await screen.findByText(/Delivery options could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Pay online/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Pay on WhatsApp/ })).toBeChecked();
    await waitFor(() => expect(placeButton()).toBeEnabled());
    expect(screen.getByRole("button", { name: "Place order" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Place order" }));
    expect(await screen.findByText("Order 4N-1042 saved")).toBeInTheDocument();
    const second = vi.mocked(placeOrder).mock.calls[1][0];
    expect(second.paymentMethod).toBe("whatsapp");
    expect(second).not.toHaveProperty("delivery");
    expect(payOrder).not.toHaveBeenCalled();
  });

  it("still offers Pay online when the shop has no delivery options and nothing failed", async () => {
    vi.mocked(getShopConfig).mockResolvedValue({ onlinePayments: true });
    vi.mocked(listDeliveryOptions).mockResolvedValue([]);
    renderPanel();

    expect(await screen.findByRole("radio", { name: /Pay online/ })).toBeInTheDocument();
    expect(screen.queryByText(/Delivery options could not be loaded/)).not.toBeInTheDocument();
  });
});

describe("placing the order", () => {
  it("calls placeOrder once with the customer, items and delivery, then shows the server total", async () => {
    const user = userEvent.setup();
    vi.mocked(placeOrder).mockResolvedValue(
      makeOrder({ delivery: { method: "collect", fee: 0 }, total: 600 }),
    );
    const { onOrderChange } = renderPanel();
    await optionsLoaded();
    await fillContact(user);
    await user.type(screen.getByLabelText("Email (optional)"), "thandi@example.com");
    await user.type(screen.getByLabelText("Note (optional)"), "Gift wrap please");
    await user.click(screen.getByRole("radio", { name: /Collect/ }));
    await user.click(placeButton());

    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(placeOrder).toHaveBeenCalledWith({
      id: expect.stringMatching(UUID_RE),
      items: [{ productId: "p1", size: "M", color: "Black", quantity: 2 }],
      customer: { name: "Thandi Nkosi", phone: "082 123 4567", email: "thandi@example.com", note: "Gift wrap please" },
      delivery: { method: "collect" },
      paymentMethod: "whatsapp",
    });
    expect(await screen.findByText("Order 4N-1042 saved")).toBeInTheDocument();
    expect(onOrderChange).toHaveBeenCalledWith(true);
  });

  it("places one order on two fast clicks", async () => {
    const user = userEvent.setup();
    const pending = deferred<Order>();
    vi.mocked(placeOrder).mockReturnValue(pending.promise);
    renderPanel();
    await optionsLoaded();
    await fillContact(user);
    await user.click(screen.getByRole("radio", { name: /Collect/ }));

    const button = placeButton();
    fireEvent.click(button);
    fireEvent.click(button);
    await user.dblClick(button);

    expect(placeOrder).toHaveBeenCalledTimes(1);
    pending.resolve(makeOrder());
    expect(await screen.findByText("Order 4N-1042 saved")).toBeInTheDocument();
    expect(placeOrder).toHaveBeenCalledTimes(1);
  });

  it("reuses the same id after a network failure, so the server keeps one order", async () => {
    const user = userEvent.setup();
    // A fake server keyed by id: the first request is saved but its reply is lost.
    const saved = new Map<string, Order>();
    let calls = 0;
    vi.mocked(placeOrder).mockImplementation(async (input) => {
      calls += 1;
      if (!saved.has(input.id)) saved.set(input.id, makeOrder({ id: input.id }));
      if (calls === 1) throw new ApiError(0, "Network error");
      return saved.get(input.id)!;
    });
    renderPanel();
    await optionsLoaded();
    await fillContact(user);
    await user.click(screen.getByRole("radio", { name: /Collect/ }));

    await user.click(placeButton());
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not place your order", { description: "Network error. Please try again." }),
    );
    expect(screen.queryByText("Order 4N-1042 saved")).not.toBeInTheDocument();

    await user.click(placeButton());
    expect(await screen.findByText("Order 4N-1042 saved")).toBeInTheDocument();

    const [first, second] = vi.mocked(placeOrder).mock.calls.map((c) => c[0].id);
    expect(first).toMatch(UUID_RE);
    expect(second).toBe(first);
    expect(saved.size).toBe(1);
  });

  it("names the short products on a 409, reloads stock and uses a new id on the next try", async () => {
    const user = userEvent.setup();
    vi.mocked(placeOrder)
      .mockRejectedValueOnce(
        new ApiError(409, "Not enough stock", {
          short: [
            { productId: "p1", name: "Classic Tee", size: "M", color: "Black", requested: 2, available: 1 },
            { productId: "p2", name: "Cap", size: "", color: "", requested: 1, available: 0 },
          ],
        }),
      )
      .mockResolvedValueOnce(makeOrder());
    const { onStockShort } = renderPanel();
    await optionsLoaded();
    await fillContact(user);
    await user.click(screen.getByRole("radio", { name: /Collect/ }));
    await user.click(placeButton());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Not enough stock", {
        description: "Classic Tee (M, Black): only 1 left, Cap: only 0 left",
      }),
    );
    expect(onStockShort).toHaveBeenCalledTimes(1);

    await user.click(placeButton());
    await screen.findByText("Order 4N-1042 saved");
    const [first, second] = vi.mocked(placeOrder).mock.calls.map((c) => c[0].id);
    expect(second).not.toBe(first);
  });

  it("shows the message for a 429 and keeps the id for the retry", async () => {
    const user = userEvent.setup();
    vi.mocked(placeOrder)
      .mockRejectedValueOnce(new ApiError(429, "Too many orders from your address. Try again in an hour."))
      .mockResolvedValueOnce(makeOrder());
    renderPanel();
    await optionsLoaded();
    await fillContact(user);
    await user.click(screen.getByRole("radio", { name: /Collect/ }));
    await user.click(placeButton());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Order limit reached", {
        description: "Too many orders from your address. Try again in an hour.",
      }),
    );
    await user.click(placeButton());
    await screen.findByText("Order 4N-1042 saved");
    const [first, second] = vi.mocked(placeOrder).mock.calls.map((c) => c[0].id);
    expect(second).toBe(first);
  });

  it("shows the message for the too_many_units 400", async () => {
    const user = userEvent.setup();
    vi.mocked(placeOrder).mockRejectedValue(
      new ApiError(400, "An order can have at most 10 items", { code: "too_many_units" }),
    );
    const { onStockShort } = renderPanel();
    await optionsLoaded();
    await fillContact(user);
    await user.click(screen.getByRole("radio", { name: /Collect/ }));
    await user.click(placeButton());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Too many items in one order", {
        description: "An order can have at most 10 items",
      }),
    );
    expect(onStockShort).not.toHaveBeenCalled();
    expect(placeButton()).toBeEnabled();
  });
});

describe("Send on WhatsApp and clearing the cart", () => {
  async function placeCollectOrder(order: Order, itemsTotal = 999) {
    const user = userEvent.setup();
    vi.mocked(placeOrder).mockResolvedValue(order);
    const handlers = renderPanel({ itemsTotal });
    await optionsLoaded();
    await fillContact(user);
    await user.click(screen.getByRole("radio", { name: /Collect/ }));
    await user.click(placeButton());
    await screen.findByText(`Order ${order.ref} saved`);
    return { user, ...handlers };
  }

  it("opens WhatsApp inside the click with the order ref and the server total", async () => {
    const open = vi.fn().mockReturnValue({});
    vi.stubGlobal("open", open);
    const order = makeOrder({ id: "ord-77", ref: "4N-2077", total: 1234.5, delivery: { method: "collect", fee: 0 } });
    await placeCollectOrder(order, 999);

    // fireEvent is synchronous: if window.open ran after an await, this would fail.
    fireEvent.click(screen.getByRole("button", { name: "Send on WhatsApp" }));
    expect(open).toHaveBeenCalledTimes(1);

    const [url, target] = open.mock.calls[0];
    expect(target).toBe("_blank");
    expect(url.startsWith(`https://wa.me/${shop.whatsappNumber}?text=`)).toBe(true);
    const text = decodeURIComponent(url.split("?text=")[1]);
    expect(text).toContain("Hi! I've placed order 4N-2077.");
    expect(text).toContain("Total: R1234.50");
    expect(text).not.toContain("999");
    expect(text).toContain(`Track your order: ${window.location.origin}/order/ord-77`);
  });

  it("keeps the cart until the customer confirms, and clears it once on Yes", async () => {
    vi.stubGlobal("open", vi.fn().mockReturnValue({}));
    const { user, onCartCleared, onOrderChange } = await placeCollectOrder(makeOrder());

    expect(onCartCleared).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Send on WhatsApp" }));
    expect(screen.getByText("Did you send your order?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open WhatsApp again" })).toBeInTheDocument();
    expect(onCartCleared).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Yes, clear cart" }));
    expect(onCartCleared).toHaveBeenCalledTimes(1);
    expect(onOrderChange).toHaveBeenLastCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith("Order sent", { description: "Thanks! We will reply on WhatsApp." });
    expect(screen.queryByText("Did you send your order?")).not.toBeInTheDocument();
  });

  it("leaves the cart intact when the customer says not yet", async () => {
    vi.stubGlobal("open", vi.fn().mockReturnValue({}));
    const { user, onCartCleared, onOrderChange } = await placeCollectOrder(makeOrder());

    await user.click(screen.getByRole("button", { name: "Send on WhatsApp" }));
    await user.click(screen.getByRole("button", { name: "Not yet" }));

    expect(onCartCleared).not.toHaveBeenCalled();
    expect(onOrderChange).not.toHaveBeenCalledWith(false);
    expect(screen.queryByText("Did you send your order?")).not.toBeInTheDocument();
    // The order is still on screen and WhatsApp can be opened again.
    expect(screen.getByText("Order 4N-1042 saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send on WhatsApp" })).toBeInTheDocument();
  });
});

describe("pay online", () => {
  it("is hidden when onlinePayments is false", async () => {
    renderPanel();
    await optionsLoaded();
    await waitFor(() => expect(getShopConfig).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("radio", { name: /Pay on WhatsApp/ })).toBeChecked();
    expect(screen.queryByRole("radio", { name: /Pay online/ })).not.toBeInTheDocument();
  });

  it("is shown when onlinePayments is true, and needs an email", async () => {
    const user = userEvent.setup();
    vi.mocked(getShopConfig).mockResolvedValue({ onlinePayments: true });
    renderPanel();
    await optionsLoaded();
    await fillContact(user);
    await user.click(screen.getByRole("radio", { name: /Collect/ }));
    await user.click(await screen.findByRole("radio", { name: /Pay online/ }));

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Place order and pay" }));
    expect(placeOrder).not.toHaveBeenCalled();
    expect(screen.getByText("Email is needed to pay online")).toBeInTheDocument();
  });

  it("saves the order, clears the cart and starts the payment; a failed payment goes to the order page", async () => {
    const user = userEvent.setup();
    vi.mocked(getShopConfig).mockResolvedValue({ onlinePayments: true });
    vi.mocked(placeOrder).mockResolvedValue(makeOrder({ id: "ord-9", paymentMethod: "online" }));
    vi.mocked(payOrder).mockRejectedValue(new ApiError(503, "Payments are off"));
    const { onCartCleared } = renderPanel();
    await optionsLoaded();
    await fillContact(user);
    await user.click(screen.getByRole("radio", { name: /Collect/ }));
    await user.click(await screen.findByRole("radio", { name: /Pay online/ }));
    await user.type(screen.getByLabelText("Email"), "thandi@example.com");
    await user.click(screen.getByRole("button", { name: "Place order and pay" }));

    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(vi.mocked(placeOrder).mock.calls[0][0].paymentMethod).toBe("online");
    expect(vi.mocked(placeOrder).mock.calls[0][0].customer.email).toBe("thandi@example.com");
    await waitFor(() => expect(payOrder).toHaveBeenCalledWith("ord-9"));
    expect(onCartCleared).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Could not start the payment", {
      description: "Your order is saved. You can pay from your order page.",
    });
    expect(await screen.findByText("Order page")).toBeInTheDocument();
  });
});

describe("controls locked while the order is being placed", () => {
  it("disables the details, delivery, address and payment controls and the button", async () => {
    const user = userEvent.setup();
    vi.mocked(getShopConfig).mockResolvedValue({ onlinePayments: true });
    const pending = deferred<Order>();
    vi.mocked(placeOrder).mockReturnValue(pending.promise);
    renderPanel();
    await optionsLoaded();
    await fillContact(user);
    await user.click(screen.getByRole("radio", { name: /Door delivery/ }));
    await user.type(screen.getByLabelText("Street address"), "12 Main Road");
    await user.type(screen.getByLabelText("Suburb"), "Sunnyside");
    await user.type(screen.getByLabelText("City"), "Pretoria");
    await user.type(screen.getByLabelText("Postal code"), "0002");
    await screen.findByRole("radio", { name: /Pay online/ });

    const controls = [
      screen.getByLabelText("Name"),
      screen.getByLabelText("Phone"),
      screen.getByLabelText("Email (optional)"),
      screen.getByLabelText("Note (optional)"),
      screen.getByLabelText("Street address"),
      screen.getByLabelText("Apartment, complex (optional)"),
      screen.getByLabelText("Suburb"),
      screen.getByLabelText("City"),
      screen.getByLabelText("Postal code"),
      screen.getByRole("radio", { name: /Door delivery/ }),
      screen.getByRole("radio", { name: /Locker/ }),
      screen.getByRole("radio", { name: /Collect/ }),
      screen.getByRole("radio", { name: /Pay on WhatsApp/ }),
      screen.getByRole("radio", { name: /Pay online/ }),
    ];
    controls.forEach((c) => expect(c).toBeEnabled());
    expect(placeButton()).toBeEnabled();

    await user.click(placeButton());
    const busy = await screen.findByRole("button", { name: "Placing order…" });
    expect(busy).toBeDisabled();
    controls.forEach((c) => expect(c).toBeDisabled());

    pending.resolve(makeOrder());
    expect(await screen.findByText("Order 4N-1042 saved")).toBeInTheDocument();
  });

  it("keeps Place order disabled while the cart is blocked", async () => {
    render(
      <MemoryRouter>
        <CheckoutPanel items={ITEMS} blocked onStockShort={vi.fn()} onCartCleared={vi.fn()} onOrderChange={vi.fn()} />
      </MemoryRouter>,
    );
    await optionsLoaded();
    expect(placeButton()).toBeDisabled();
  });
});

describe("discount code", () => {
  const codeInput = () => screen.getByLabelText("Have a discount code?");
  const applyButton = () => screen.getByRole("button", { name: /^(Apply|Checking)/ });

  function renderWithItems(items = ITEMS, itemsTotal = 600) {
    const handlers: Handlers = { onStockShort: vi.fn(), onCartCleared: vi.fn(), onOrderChange: vi.fn() };
    const tree = (list: typeof ITEMS) => (
      <MemoryRouter initialEntries={["/checkout"]}>
        <Routes>
          <Route
            path="/checkout"
            element={<CheckoutPanel items={list} blocked={false} itemsTotal={itemsTotal} {...handlers} />}
          />
          <Route path="/order/:id" element={<p>Order page</p>} />
        </Routes>
      </MemoryRouter>
    );
    const view = render(tree(items));
    return { ...handlers, rerenderItems: (list: typeof ITEMS) => view.rerender(tree(list)) };
  }

  async function apply(user: ReturnType<typeof userEvent.setup>, code = "save50") {
    await user.type(codeInput(), code);
    await user.click(applyButton());
  }

  const estimated = () => screen.getByText("Estimated total").nextElementSibling;

  it("has an input that capitalises and does not autofill", async () => {
    renderPanel();
    await optionsLoaded();
    expect(codeInput()).toHaveAttribute("autocapitalize", "characters");
    expect(codeInput()).toHaveAttribute("autocomplete", "off");
  });

  it("shows the applied code and amount and lowers the estimated total", async () => {
    const user = userEvent.setup();
    vi.mocked(checkDiscountCode).mockResolvedValue({ code: "SAVE50", amount: 50 });
    renderPanel({ itemsTotal: 600 });
    await optionsLoaded();
    await user.click(screen.getByRole("radio", { name: /Door delivery/ }));
    expect(estimated()).toHaveTextContent("R660.00");

    await apply(user);
    expect(checkDiscountCode).toHaveBeenCalledWith(ITEMS, "save50");
    expect(await screen.findByText("SAVE50: -R50.00")).toBeInTheDocument();
    expect(estimated()).toHaveTextContent("R610.00");
    expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();
    expect(screen.queryByLabelText("Have a discount code?")).not.toBeInTheDocument();
  });

  it("shows the server message for an invalid code and applies nothing", async () => {
    const user = userEvent.setup();
    vi.mocked(checkDiscountCode).mockResolvedValue({ error: "That code isn't valid", code: "discount_invalid" });
    renderPanel({ itemsTotal: 600 });
    await optionsLoaded();
    await user.click(screen.getByRole("radio", { name: /Collect/ }));
    await apply(user, "nope");

    expect(await screen.findByText("That code isn't valid")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(estimated()).toHaveTextContent("R600.00");
  });

  it("shows the message for a rate_limited answer", async () => {
    const user = userEvent.setup();
    vi.mocked(checkDiscountCode).mockResolvedValue({
      error: "Too many tries. Please wait a while and try again.",
      code: "rate_limited",
    });
    renderPanel();
    await optionsLoaded();
    await apply(user);
    expect(await screen.findByText("Too many tries. Please wait a while and try again.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("Remove clears the code and restores the total", async () => {
    const user = userEvent.setup();
    vi.mocked(checkDiscountCode).mockResolvedValue({ code: "SAVE50", amount: 50 });
    renderPanel({ itemsTotal: 600 });
    await optionsLoaded();
    await user.click(screen.getByRole("radio", { name: /Collect/ }));
    await apply(user);
    await screen.findByText("SAVE50: -R50.00");
    expect(estimated()).toHaveTextContent("R550.00");

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("SAVE50: -R50.00")).not.toBeInTheDocument();
    expect(codeInput()).toHaveValue("");
    expect(estimated()).toHaveTextContent("R600.00");
  });

  it("adds a Discount row to the Summary between Items and Delivery, and drops it after Remove", async () => {
    const user = userEvent.setup();
    vi.mocked(checkDiscountCode).mockResolvedValue({ code: "TEST20", amount: 10 });
    renderPanel({ itemsTotal: 50 });
    await optionsLoaded();
    await user.click(screen.getByRole("radio", { name: /Collect/ }));
    expect(screen.queryByText("Discount (TEST20)")).not.toBeInTheDocument();
    await apply(user, "test20");

    const label = await screen.findByText("Discount (TEST20)");
    expect(label.nextElementSibling).toHaveTextContent("-R10.00");
    expect(label.previousElementSibling).toBeNull();
    expect(label.parentElement?.previousElementSibling).toHaveTextContent("ItemsR50.00");
    expect(label.parentElement?.nextElementSibling).toHaveTextContent("Delivery");
    expect(estimated()).toHaveTextContent("R40.00");

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("Discount (TEST20)")).not.toBeInTheDocument();
    expect(estimated()).toHaveTextContent("R50.00");
  });

  async function placeWithCollect(user: ReturnType<typeof userEvent.setup>) {
    await fillContact(user);
    await user.click(screen.getByRole("radio", { name: /Collect/ }));
    await user.click(placeButton());
  }

  it("sends the applied code with placeOrder", async () => {
    const user = userEvent.setup();
    vi.mocked(checkDiscountCode).mockResolvedValue({ code: "SAVE50", amount: 50 });
    vi.mocked(placeOrder).mockResolvedValue(makeOrder());
    renderPanel();
    await optionsLoaded();
    await apply(user);
    await screen.findByText("SAVE50: -R50.00");
    await placeWithCollect(user);

    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(placeOrder).toHaveBeenCalledWith({
      id: expect.stringMatching(UUID_RE),
      items: ITEMS,
      customer: { name: "Thandi Nkosi", phone: "082 123 4567" },
      delivery: { method: "collect" },
      paymentMethod: "whatsapp",
      discountCode: "SAVE50",
    });
  });

  it("leaves the discountCode key out when no code is applied, including a typed but unapplied one and a removed one", async () => {
    const user = userEvent.setup();
    vi.mocked(checkDiscountCode).mockResolvedValue({ code: "SAVE50", amount: 50 });
    vi.mocked(placeOrder).mockResolvedValue(makeOrder());
    renderPanel();
    await optionsLoaded();
    await user.type(codeInput(), "typed-only");
    await placeWithCollect(user);

    const sent = vi.mocked(placeOrder).mock.calls[0][0];
    expect(Object.keys(sent).sort()).toEqual(["customer", "delivery", "id", "items", "paymentMethod"]);
    expect(checkDiscountCode).not.toHaveBeenCalled();
  });

  it("leaves the key out after Remove", async () => {
    const user = userEvent.setup();
    vi.mocked(checkDiscountCode).mockResolvedValue({ code: "SAVE50", amount: 50 });
    vi.mocked(placeOrder).mockResolvedValue(makeOrder());
    renderPanel();
    await optionsLoaded();
    await apply(user);
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    await placeWithCollect(user);
    expect("discountCode" in vi.mocked(placeOrder).mock.calls[0][0]).toBe(false);
  });

  it.each([
    ["discount_invalid", "That code isn't valid", {}],
    ["discount_minimum", "Spend at least R500.00 to use this code", { minSpend: 500 }],
  ])("a 409 %s is not a stock shortfall: clears the code, keeps the form and retries with a new id", async (code, message, extra) => {
    const user = userEvent.setup();
    vi.mocked(checkDiscountCode).mockResolvedValue({ code: "SAVE50", amount: 50 });
    vi.mocked(placeOrder)
      .mockRejectedValueOnce(new ApiError(409, message, { error: message, code, ...extra }))
      .mockResolvedValueOnce(makeOrder());
    const { onStockShort } = renderPanel({ itemsTotal: 600 });
    await optionsLoaded();
    await apply(user);
    await screen.findByText("SAVE50: -R50.00");
    await placeWithCollect(user);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Discount code not applied", { description: message }));
    expect(toast.error).not.toHaveBeenCalledWith("Not enough stock", expect.anything());
    expect(onStockShort).not.toHaveBeenCalled();
    // Cleared, with the message beside the input, and the customer's form is still filled in.
    expect(screen.queryByText("SAVE50: -R50.00")).not.toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(estimated()).toHaveTextContent("R600.00");
    expect(screen.getByLabelText("Name")).toHaveValue("Thandi Nkosi");
    expect(screen.getByLabelText("Phone")).toHaveValue("082 123 4567");
    expect(screen.getByRole("radio", { name: /Collect/ })).toBeChecked();
    expect(placeButton()).toBeEnabled();

    await user.click(placeButton());
    await screen.findByText("Order 4N-1042 saved");
    const [first, second] = vi.mocked(placeOrder).mock.calls.map((c) => c[0]);
    expect(second.id).not.toBe(first.id);
    expect(first.discountCode).toBe("SAVE50");
    expect("discountCode" in second).toBe(false);
  });

  it("clears the applied code when the items change and asks to check it again", async () => {
    const user = userEvent.setup();
    vi.mocked(checkDiscountCode).mockResolvedValue({ code: "SAVE50", amount: 50 });
    vi.mocked(placeOrder).mockResolvedValue(makeOrder());
    const { rerenderItems } = renderWithItems(ITEMS, 600);
    await optionsLoaded();
    await user.click(screen.getByRole("radio", { name: /Collect/ }));
    await apply(user);
    await screen.findByText("SAVE50: -R50.00");

    rerenderItems([{ productId: "p1", size: "M", color: "Black", quantity: 3 }]);
    expect(await screen.findByText("Check your code again")).toBeInTheDocument();
    expect(screen.queryByText("SAVE50: -R50.00")).not.toBeInTheDocument();
    expect(estimated()).toHaveTextContent("R600.00");

    await placeWithCollect(user);
    expect("discountCode" in vi.mocked(placeOrder).mock.calls[0][0]).toBe(false);
  });

  it("locks the code controls while placing, and hides them once placed", async () => {
    const user = userEvent.setup();
    const pending = deferred<Order>();
    vi.mocked(placeOrder).mockReturnValue(pending.promise);
    renderPanel();
    await optionsLoaded();
    expect(codeInput()).toBeEnabled();
    expect(applyButton()).toBeEnabled();
    await placeWithCollect(user);
    await screen.findByRole("button", { name: "Placing order…" });
    expect(codeInput()).toBeDisabled();
    expect(applyButton()).toBeDisabled();

    pending.resolve(makeOrder());
    await screen.findByText("Order 4N-1042 saved");
    expect(screen.queryByLabelText("Have a discount code?")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
  });

  it("locks Remove while placing", async () => {
    const user = userEvent.setup();
    vi.mocked(checkDiscountCode).mockResolvedValue({ code: "SAVE50", amount: 50 });
    const pending = deferred<Order>();
    vi.mocked(placeOrder).mockReturnValue(pending.promise);
    renderPanel();
    await optionsLoaded();
    await apply(user);
    await screen.findByText("SAVE50: -R50.00");
    await placeWithCollect(user);
    await screen.findByRole("button", { name: "Placing order…" });
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();

    pending.resolve(makeOrder());
    await screen.findByText("Order 4N-1042 saved");
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("shows the server total and the discount line after placing, and sends both on WhatsApp", async () => {
    const user = userEvent.setup();
    const open = vi.fn().mockReturnValue({});
    vi.stubGlobal("open", open);
    vi.mocked(checkDiscountCode).mockResolvedValue({ code: "SAVE50", amount: 50 });
    vi.mocked(placeOrder).mockResolvedValue(
      makeOrder({ ref: "4N-3001", id: "ord-9", total: 550, discountCode: "SAVE50", discountAmount: 50, delivery: { method: "collect", fee: 0 } }),
    );
    renderPanel({ itemsTotal: 999 });
    await optionsLoaded();
    await apply(user);
    await screen.findByText("SAVE50: -R50.00");
    await placeWithCollect(user);

    await screen.findByText("Order 4N-3001 saved");
    expect(screen.getByText("Discount (SAVE50)")).toBeInTheDocument();
    expect(screen.getByText("R550.00")).toBeInTheDocument();
    expect(screen.queryByText("R999.00")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send on WhatsApp" }));
    const text = decodeURIComponent(open.mock.calls[0][0].split("?text=")[1]);
    expect(text).toContain("Discount (SAVE50): -R50.00\nDelivery: Collect");
    expect(text).toContain("Total: R550.00");
  });
});
