import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { clampMenuPosition } from "../layout";

describe("layout utilities", () => {
  describe("clampMenuPosition", () => {
    let originalWidth: number;
    let originalHeight: number;

    beforeEach(() => {
      originalWidth = window.innerWidth;
      originalHeight = window.innerHeight;
      Object.defineProperty(window, "innerWidth", {
        value: 1000,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, "innerHeight", {
        value: 800,
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(window, "innerWidth", {
        value: originalWidth,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, "innerHeight", {
        value: originalHeight,
        writable: true,
        configurable: true,
      });
    });

    it("places menu to the right/below the cursor when space allows", () => {
      const pos = clampMenuPosition(100, 100, 200, 200, 10, 10);
      expect(pos.x).toBe(110);
      expect(pos.y).toBe(110);
    });

    it("flips left when the menu would overflow the right edge", () => {
      const pos = clampMenuPosition(900, 100, 200, 200, 10, 10);
      // 900 + 10 + 200 = 1110 > 990 (1000 - 10), so flip
      expect(pos.x).toBeLessThan(900);
    });

    it("flips above when the menu would overflow the bottom edge", () => {
      const pos = clampMenuPosition(100, 700, 200, 200, 10, 10);
      expect(pos.y).toBeLessThan(700);
    });

    it("honours minEdgeGap as a floor", () => {
      const pos = clampMenuPosition(0, 0, 200, 200, 10, 15);
      expect(pos.x).toBeGreaterThanOrEqual(15);
      expect(pos.y).toBeGreaterThanOrEqual(15);
    });

    it("uses default menu dimensions when not provided", () => {
      // Should not throw and should return numeric coords
      const pos = clampMenuPosition(500, 400);
      expect(typeof pos.x).toBe("number");
      expect(typeof pos.y).toBe("number");
    });
  });
});
