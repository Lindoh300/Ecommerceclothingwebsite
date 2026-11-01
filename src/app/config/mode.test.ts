// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MODE_KEY, MODE_SCRIPT, applyMode, readMode } from "./mode";

afterEach(() => {
  delete document.documentElement.dataset.mode;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("MODE_SCRIPT", () => {
  it("applies a stored dark mode", () => {
    localStorage.setItem(MODE_KEY, "dark");
    new Function(MODE_SCRIPT)();
    expect(document.documentElement.dataset.mode).toBe("dark");
  });

  it("leaves light when nothing is stored", () => {
    new Function(MODE_SCRIPT)();
    expect(document.documentElement.dataset.mode).toBeUndefined();
    expect(readMode()).toBe("light");
  });
});

describe("applyMode", () => {
  it("sets and clears the attribute and storage", () => {
    applyMode("dark");
    expect(readMode()).toBe("dark");
    expect(localStorage.getItem(MODE_KEY)).toBe("dark");
    applyMode("light");
    expect(document.documentElement.dataset.mode).toBeUndefined();
    expect(localStorage.getItem(MODE_KEY)).toBe("light");
  });

  it("still switches the page when storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => applyMode("dark")).not.toThrow();
    expect(readMode()).toBe("dark");
  });
});
