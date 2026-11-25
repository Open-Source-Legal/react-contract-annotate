import * as C from "../constants";

test("ported values match OpenContracts", () => {
  expect(C.ZOOM_MIN).toBe(0.5);
  expect(C.ZOOM_MAX).toBe(4);
  expect(C.FIT_WIDTH_MARGIN).toBe(16);
  expect(C.OC_URL_LABEL).toBe("OC_URL");
});

test("library additions", () => {
  expect(C.ZOOM_STEP).toBe(0.1);
  expect(C.SCROLL_SETTLE_TIMEOUT_MS).toBe(5000);
});
