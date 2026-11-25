import { nearestScrollDelta } from "../centreBox";

// A view from 100 to 300 (200 wide).
const VIEW_START = 100;
const VIEW_END = 300;

describe("nearestScrollDelta (CSSOM 'nearest')", () => {
  test("a box inside the view needs no scroll", () => {
    expect(nearestScrollDelta(150, 250, VIEW_START, VIEW_END)).toBe(0);
    expect(nearestScrollDelta(100, 300, VIEW_START, VIEW_END)).toBe(0);
  });

  test("a box that covers the whole view needs no scroll", () => {
    expect(nearestScrollDelta(50, 350, VIEW_START, VIEW_END)).toBe(0);
  });

  test("a box that fits moves just far enough to show its far edge", () => {
    // Sticks out after the view: align its end with the view's end.
    expect(nearestScrollDelta(280, 340, VIEW_START, VIEW_END)).toBe(40);
    // Entirely after the view.
    expect(nearestScrollDelta(400, 450, VIEW_START, VIEW_END)).toBe(150);
    // Sticks out before the view: align its start with the view's start.
    expect(nearestScrollDelta(80, 120, VIEW_START, VIEW_END)).toBe(-20);
  });

  test("a box bigger than the view aligns the edge that is inside it", () => {
    // Starts inside, runs past the end: align its start.
    expect(nearestScrollDelta(150, 450, VIEW_START, VIEW_END)).toBe(50);
    // Ends inside, starts before: align its end.
    expect(nearestScrollDelta(-50, 250, VIEW_START, VIEW_END)).toBe(-50);
  });
});
