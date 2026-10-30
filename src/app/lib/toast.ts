// Toasts load sonner on first use, so it stays out of the first-load JS of every page. Use this
// instead of importing `toast` from "sonner". The <Toaster /> in Root is loaded the same way.
type Sonner = typeof import("sonner").toast;

export const toast = {
  error: (...args: Parameters<Sonner["error"]>): void => {
    void import("sonner").then((m) => m.toast.error(...args));
  },
  success: (...args: Parameters<Sonner["success"]>): void => {
    void import("sonner").then((m) => m.toast.success(...args));
  },
};
