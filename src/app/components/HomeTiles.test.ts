import { describe, expect, it } from "vitest";
import { categorySpans } from "./HomeTiles";

describe("categorySpans", () => {
  it.each([
    [1, [12]],
    [2, [6, 6]],
    [3, [5, 4, 3]],
    [4, [5, 4, 3, 12]],
    [5, [5, 4, 3, 6, 6]],
    [6, [5, 4, 3, 3, 4, 5]],
    [7, [5, 4, 3, 3, 4, 5, 12]],
  ])("n = %i", (n, expected) => {
    expect(categorySpans(n)).toEqual(expected);
  });
});
