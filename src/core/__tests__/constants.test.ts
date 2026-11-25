import * as C from "../constants";

test("ported values match OpenContracts", () => {
  expect(C.ZOOM_MIN).toBe(0.5);
  expect(C.ZOOM_MAX).toBe(4);
  expect(C.FIT_WIDTH_MARGIN).toBe(16);
  expect(C.REFERENCE_MENTION_DISPLAY_NAMES).toEqual({
    OC_REF_LAW: "Law",
    OC_REF_DOC: "Exhibit",
    OC_REF_SECTION: "Section",
    OC_REF_TERM: "Defined term",
  });
  expect(C.DEFAULT_LABEL_COLOR).toBe("#616a6b");
});

test("library additions", () => {
  expect(C.ZOOM_STEP).toBe(0.1);
  expect(C.SCROLL_SETTLE_TIMEOUT_MS).toBe(5000);
  expect(C.SCROLL_LANDED_TOLERANCE_PX).toBe(1);
  expect(C.SCROLL_SETTLE_FRAMES).toBe(10);
});
