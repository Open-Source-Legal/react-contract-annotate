import { hexToRgb } from "../transform";

/** What `hexToRgb` falls back to for anything but hex (OpenContracts' yellow). */
const YELLOW = { r: 255, g: 255, b: 0 };

test("reads 6-digit hex, with or without the #", () => {
  expect(hexToRgb("#FF0000")).toEqual({ r: 255, g: 0, b: 0 });
  expect(hexToRgb("00ff00")).toEqual({ r: 0, g: 255, b: 0 });
  expect(hexToRgb("#2563eb")).toEqual({ r: 37, g: 99, b: 235 });
});

test("reads 3-digit hex as its doubled digits", () => {
  expect(hexToRgb("#F00")).toEqual({ r: 255, g: 0, b: 0 });
  expect(hexToRgb("0f0")).toEqual({ r: 0, g: 255, b: 0 });
  expect(hexToRgb("#abc")).toEqual({ r: 170, g: 187, b: 204 });
});

test("reads 8-digit hex, ignoring the alpha", () => {
  expect(hexToRgb("#ff000080")).toEqual({ r: 255, g: 0, b: 0 });
  expect(hexToRgb("2563ebff")).toEqual({ r: 37, g: 99, b: 235 });
});

test("falls back to yellow for anything else", () => {
  for (const color of [
    "red",
    "rgb(255, 0, 0)",
    "#ff00",
    "#fffff",
    "#gggggg",
    "#ff0000ff00",
    "",
  ]) {
    expect([color, hexToRgb(color)]).toEqual([color, YELLOW]);
  }
});
