import * as C from "../constants";

test("ported values match OpenContracts", () => {
  expect(C.PAGE_SPANNING_TOKEN_THRESHOLD).toBe(0.9);
});

test("library additions", () => {
  expect(C.PAGE_GAP_PX).toBe(32);
  expect(C.PAGE_OVERSCAN).toBe(2);
  expect(C.PAGE_RENDER_DEBOUNCE_MS).toBe(100);
});
