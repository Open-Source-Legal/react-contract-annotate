import * as C from "../constants";

test("ported values match OpenContracts", () => {
  expect(C.PAGE_SPANNING_TOKEN_THRESHOLD).toBe(0.9);
  expect(C.Z_INDEX).toEqual({ PDF_NATIVE_LINK_LAYER: 2 });
  expect(C.SELECTION_COLOR).toBe("#0066cc");
  expect(C.LONG_PRESS_MS).toBe(500);
  expect(C.TOUCH_MOVE_THRESHOLD_PX).toBe(10);
  expect(C.LONG_PRESS_VIBRATION_MS).toBe(50);
  expect(C.REJECTED_RGB).toEqual({ r: 128, g: 0, b: 0 });
  expect(C.APPROVED_RGB).toEqual({ r: 46, g: 204, b: 113 });
  expect(C.ANNOTATION_BOUNDARY_RADIUS).toBe("6px");
  expect(C.ANNOTATION_TOKEN_RADIUS).toBe("4px");
  expect(C.BOUNDARY_OPACITY_SELECTED).toBe(0.18);
  expect(C.BOUNDARY_OPACITY_UNSELECTED).toBe(0.06);
  expect(C.TOKEN_OPACITY_HIGH).toBe(0.38);
  expect(C.TOKEN_OPACITY_LOW).toBe(0.22);
  expect(C.TOKEN_SHADOW_BLUR).toBe(4);
  expect(C.TOKEN_SHADOW_SPREAD).toBe(1);
  expect(C.TOKEN_EXPANSION_PX).toBe(1);
  expect(C.ANNOTATION_LABEL_FONT_WEIGHT).toBe("bold");
  expect(C.ANNOTATION_LABEL_FONT_SIZE).toBe("12px");
  expect(C.RELATION_BADGE_Z_INDEX).toBe(1);
  expect(C.RELATION_BADGE_FONT_SIZE).toBe("0.75rem");
});

test("library additions", () => {
  expect(C.PAGE_GAP_PX).toBe(32);
  expect(C.PAGE_OVERSCAN).toBe(2);
  expect(C.PAGE_RENDER_DEBOUNCE_MS).toBe(100);
  expect(C.CLICK_DRAG_TOLERANCE_PX).toBe(3);
});
