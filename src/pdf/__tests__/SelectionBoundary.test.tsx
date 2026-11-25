/**
 * Ported from OpenContracts' `SelectionBoundary.test.tsx` (98286cabf): click
 * semantics, translucent fill and box-shadow halo. The boundary reads no
 * annotator state (the annotation-ref registry and `isCreatingAnnotation`
 * that OpenContracts mocked are gone), so it renders without a provider.
 *
 * Added: Ctrl / Cmd behave like Shift, and `onClickWithoutDrag` fires for
 * every click whose press and release are within the drag tolerance.
 */
import { fireEvent, render } from "@testing-library/react";

import { SelectionBoundary } from "../SelectionBoundary";
import {
  BOUNDARY_OPACITY_SELECTED,
  BOUNDARY_OPACITY_UNSELECTED,
  CLICK_DRAG_TOLERANCE_PX,
} from "../constants";

const bounds = { left: 0, top: 0, right: 100, bottom: 50 };

// Required props that every test needs — extracted so the per-test JSX
// stays focused on the prop under test (clickThroughOnPlainClick, etc.).
const baseProps = {
  hidden: false,
  selected: false,
} as const;

function boundary(container: HTMLElement): HTMLElement {
  return container.querySelector("span") as HTMLElement;
}

describe("SelectionBoundary click semantics", () => {
  it("does NOT call onClick on a plain click by default", () => {
    const onClick = vi.fn();
    const { container } = render(
      <SelectionBoundary
        {...baseProps}
        color="#0066cc"
        bounds={bounds}
        onClick={onClick}
      />
    );
    fireEvent.click(boundary(container));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("calls onClick on a shift-click (default behaviour)", () => {
    const onClick = vi.fn();
    const { container } = render(
      <SelectionBoundary
        {...baseProps}
        color="#0066cc"
        bounds={bounds}
        onClick={onClick}
      />
    );
    fireEvent.click(boundary(container), { shiftKey: true });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("calls onClick on a ctrl-click and on a cmd-click", () => {
    const onClick = vi.fn();
    const { container } = render(
      <SelectionBoundary
        {...baseProps}
        color="#0066cc"
        bounds={bounds}
        onClick={onClick}
      />
    );
    fireEvent.click(boundary(container), { ctrlKey: true });
    fireEvent.click(boundary(container), { metaKey: true });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("calls onClick on a plain click when clickThroughOnPlainClick is true", () => {
    // Link path: the surrounding renderer wires ``clickThroughOnPlainClick``
    // so a plain click opens the URL.
    const onClick = vi.fn();
    const { container } = render(
      <SelectionBoundary
        {...baseProps}
        color="#0066cc"
        bounds={bounds}
        onClick={onClick}
        clickThroughOnPlainClick
      />
    );
    fireEvent.click(boundary(container));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows pointer cursor when clickThroughOnPlainClick is true", () => {
    // Visible affordance: hyperlink-style annotations must use a pointer
    // cursor so the user knows the span is clickable.
    const { container } = render(
      <SelectionBoundary
        {...baseProps}
        color="#0066cc"
        bounds={bounds}
        onClick={vi.fn()}
        clickThroughOnPlainClick
      />
    );
    expect(boundary(container).style.cursor).toBe("pointer");
  });

  it("does NOT set pointer cursor when clickThroughOnPlainClick is false", () => {
    const { container } = render(
      <SelectionBoundary
        {...baseProps}
        color="#0066cc"
        bounds={bounds}
        onClick={vi.fn()}
      />
    );
    expect(boundary(container).style.cursor).toBe("");
  });

  it("noop on mouseDown without onClick prop", () => {
    // ``handleMouseDown``'s early-return when ``!onClick`` is the guard
    // branch. Just rendering without onClick and firing the event must not
    // throw.
    const { container } = render(
      <SelectionBoundary {...baseProps} color="#0066cc" bounds={bounds} />
    );
    expect(() =>
      fireEvent.mouseDown(boundary(container), { shiftKey: true })
    ).not.toThrow();
  });

  it("stops mouseDown propagation on shift+mousedown", () => {
    // The boundary swallows shift+mousedown so the underlying selection
    // layer doesn't restart a drag-selection over an existing annotation.
    const onClick = vi.fn();
    const parentMouseDown = vi.fn();
    const { container } = render(
      <div onMouseDown={parentMouseDown}>
        <SelectionBoundary
          {...baseProps}
          color="#0066cc"
          bounds={bounds}
          onClick={onClick}
        />
      </div>
    );
    fireEvent.mouseDown(boundary(container), { shiftKey: true });
    fireEvent.mouseDown(boundary(container), { ctrlKey: true });
    fireEvent.mouseDown(boundary(container), { metaKey: true });
    // The parent handler must not see the event due to stopPropagation.
    expect(parentMouseDown).not.toHaveBeenCalled();
  });

  it("lets a plain mousedown through to the layers below", () => {
    const parentMouseDown = vi.fn();
    const { container } = render(
      <div onMouseDown={parentMouseDown}>
        <SelectionBoundary
          {...baseProps}
          color="#0066cc"
          bounds={bounds}
          onClick={vi.fn()}
        />
      </div>
    );
    fireEvent.mouseDown(boundary(container));
    expect(parentMouseDown).toHaveBeenCalledTimes(1);
  });
});

describe("SelectionBoundary onClickWithoutDrag", () => {
  function renderWithClickSpy() {
    const onClickWithoutDrag = vi.fn();
    const { container } = render(
      <SelectionBoundary
        {...baseProps}
        color="#0066cc"
        bounds={bounds}
        onClickWithoutDrag={onClickWithoutDrag}
      />
    );
    return { span: boundary(container), onClickWithoutDrag };
  }

  it("fires for a plain click and for a modifier click", () => {
    const { span, onClickWithoutDrag } = renderWithClickSpy();
    fireEvent.mouseDown(span, { clientX: 10, clientY: 10 });
    fireEvent.click(span, { clientX: 10, clientY: 10 });
    fireEvent.mouseDown(span, { clientX: 10, clientY: 10, shiftKey: true });
    fireEvent.click(span, { clientX: 10, clientY: 10, shiftKey: true });
    expect(onClickWithoutDrag).toHaveBeenCalledTimes(2);
  });

  it("fires when press and release are within the tolerance", () => {
    const { span, onClickWithoutDrag } = renderWithClickSpy();
    fireEvent.mouseDown(span, { clientX: 10, clientY: 10 });
    fireEvent.click(span, { clientX: 10 + CLICK_DRAG_TOLERANCE_PX, clientY: 10 });
    expect(onClickWithoutDrag).toHaveBeenCalledTimes(1);
  });

  it("does not fire after a drag", () => {
    const { span, onClickWithoutDrag } = renderWithClickSpy();
    fireEvent.mouseDown(span, { clientX: 10, clientY: 10 });
    fireEvent.click(span, {
      clientX: 10 + CLICK_DRAG_TOLERANCE_PX + 1,
      clientY: 10,
    });
    expect(onClickWithoutDrag).not.toHaveBeenCalled();
  });
});

describe("SelectionBoundary translucent fill", () => {
  // #0066cc → rgb(0, 102, 204); the fill is rgba(r, g, b, opacity).
  it("renders the unselected fill even when showBoundingBox is false", () => {
    const { container } = render(
      <SelectionBoundary
        {...baseProps}
        color="#0066cc"
        bounds={bounds}
        showBoundingBox={false}
      />
    );
    expect(boundary(container).style.backgroundColor).toBe(
      `rgba(0, 102, 204, ${BOUNDARY_OPACITY_UNSELECTED})`
    );
  });

  it("forces a fully transparent fill when hidden, regardless of showBoundingBox", () => {
    const { container } = render(
      <SelectionBoundary
        {...baseProps}
        hidden
        color="#0066cc"
        bounds={bounds}
        showBoundingBox
      />
    );
    expect(boundary(container).style.backgroundColor).toBe(
      "rgba(0, 102, 204, 0)"
    );
  });

  it("renders the stronger selected fill when selected and showBoundingBox is false", () => {
    const { container } = render(
      <SelectionBoundary
        {...baseProps}
        selected
        color="#0066cc"
        bounds={bounds}
        showBoundingBox={false}
      />
    );
    expect(boundary(container).style.backgroundColor).toBe(
      `rgba(0, 102, 204, ${BOUNDARY_OPACITY_SELECTED})`
    );
  });
});

describe("SelectionBoundary box-shadow halo", () => {
  // The fill is decoupled from showBoundingBox, but the box-shadow halo
  // must stay gated by it — this is the other half of the invariant.
  it("omits the box-shadow halo when showBoundingBox is false", () => {
    const { container } = render(
      <SelectionBoundary
        {...baseProps}
        color="#0066cc"
        bounds={bounds}
        showBoundingBox={false}
      />
    );
    expect(boundary(container).style.boxShadow).toBe("none");
  });

  it("renders the box-shadow halo when showBoundingBox is true", () => {
    const { container } = render(
      <SelectionBoundary
        {...baseProps}
        color="#0066cc"
        bounds={bounds}
        showBoundingBox
      />
    );
    const span = boundary(container);
    expect(span.style.boxShadow).not.toBe("none");
    expect(span.style.boxShadow).not.toBe("");
  });

  it("omits the box-shadow halo when hidden, even if showBoundingBox is true", () => {
    const { container } = render(
      <SelectionBoundary
        {...baseProps}
        hidden
        color="#0066cc"
        bounds={bounds}
        showBoundingBox
      />
    );
    expect(boundary(container).style.boxShadow).toBe("none");
  });
});

describe("SelectionBoundary geometry", () => {
  it("positions the box at its bounds", () => {
    const { container } = render(
      <SelectionBoundary
        {...baseProps}
        color="#0066cc"
        bounds={{ left: 12.5, top: 20, right: 112.5, bottom: 45 }}
      />
    );
    const { left, top, width, height } = boundary(container).style;
    expect({ left, top, width, height }).toEqual({
      left: "12.5px",
      top: "20px",
      width: "100px",
      height: "25px",
    });
  });
});
