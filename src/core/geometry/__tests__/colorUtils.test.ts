import { describe, it, expect } from "vitest";
import { computeAnnotationBoxShadow } from "../colorUtils";

describe("colorUtils", () => {
  describe("computeAnnotationBoxShadow", () => {
    it("produces three shadow layers for unselected", () => {
      const shadow = computeAnnotationBoxShadow(255, 0, 0, false);
      expect((shadow.match(/rgba\(/g) ?? []).length).toBe(3);
      expect(shadow).toContain("rgba(255, 0, 0");
      expect(shadow).toContain("inset");
    });

    it("produces three shadow layers for selected", () => {
      const shadow = computeAnnotationBoxShadow(0, 128, 255, true);
      expect((shadow.match(/rgba\(/g) ?? []).length).toBe(3);
      expect(shadow).toContain("rgba(0, 128, 255");
    });

    it("differs between selected and unselected states", () => {
      const unselected = computeAnnotationBoxShadow(10, 20, 30, false);
      const selected = computeAnnotationBoxShadow(10, 20, 30, true);
      expect(unselected).not.toBe(selected);
    });
  });

});
