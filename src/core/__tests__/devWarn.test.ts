import { createStore } from "jotai";
import { afterEach, beforeEach, vi, type MockInstance } from "vitest";
import { devWarnOnce } from "../devWarn";

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("warns once per key on a store", () => {
  const store = createStore();
  devWarnOnce(store, "zoom", "zoom is ignored on DOCX");
  devWarnOnce(store, "zoom", "zoom is ignored on DOCX");
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith("zoom is ignored on DOCX");
});

test("different keys on the same store each warn", () => {
  const store = createStore();
  devWarnOnce(store, "a", "first");
  devWarnOnce(store, "b", "second");
  expect(warn.mock.calls.map((c) => c[0])).toEqual(["first", "second"]);
});

test("two stores warn independently", () => {
  const first = createStore();
  const second = createStore();
  devWarnOnce(first, "zoom", "message");
  devWarnOnce(second, "zoom", "message");
  devWarnOnce(first, "zoom", "message");
  devWarnOnce(second, "zoom", "message");
  expect(warn).toHaveBeenCalledTimes(2);
});

test("is silent when NODE_ENV is production", () => {
  vi.stubEnv("NODE_ENV", "production");
  const store = createStore();
  devWarnOnce(store, "zoom", "message");
  expect(warn).not.toHaveBeenCalled();
});

test("a suppressed production call does not consume the key", () => {
  const store = createStore();
  vi.stubEnv("NODE_ENV", "production");
  devWarnOnce(store, "zoom", "message");
  vi.stubEnv("NODE_ENV", "test");
  devWarnOnce(store, "zoom", "message");
  expect(warn).toHaveBeenCalledTimes(1);
});
