import { PAGE_NUMBER_CLASS } from "../constants";
import { selectedSpan, selectionIn } from "../textSelection";

vi.mock("docxodus", async () =>
  (await import("./docxodusFake")).docxodusModule()
);

const WORD = "ab";
const COUNT = 150;
/** "ab ab ab …": the word `COUNT` times, each occurrence 3 characters apart. */
const TEXT = Array.from({ length: COUNT }, () => WORD).join(" ");

let pages: HTMLElement;

beforeEach(() => {
  pages = document.createElement("div");
  pages.innerHTML = `<p>${TEXT}</p><span class="${PAGE_NUMBER_CLASS}">1</span>`;
  document.body.append(pages);
});

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  pages.remove();
});

/** Selects the `n`th (from 0) occurrence of the word in the pages. */
function selectOccurrence(n: number): Selection {
  const node = pages.querySelector("p")?.firstChild as Text;
  const range = document.createRange();
  range.setStart(node, n * 3);
  range.setEnd(node, n * 3 + WORD.length);
  const selection = document.getSelection() as Selection;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

test("the occurrence selected is found however many come before it (docxodus stops at 100 by default)", () => {
  for (const n of [0, 99, 100, 120, COUNT - 1]) {
    const selection = selectionIn(pages);
    expect(selection).toBeNull();
    selectOccurrence(n);
    const span = selectedSpan(
      TEXT,
      selectionIn(pages) as Selection,
      pages,
      PAGE_NUMBER_CLASS
    );
    expect(span).toEqual({ start: n * 3, end: n * 3 + WORD.length });
    document.getSelection()?.removeAllRanges();
  }
});

describe("text whose whitespace the laid-out pages show differently", () => {
  /**
   * Lays `shown` out as one paragraph and selects `[from, to)` of it, from
   * the end back to the start when `backward`; returns the span found in
   * `text`.
   */
  function spanOf(
    text: string,
    shown: string,
    from: number,
    to: number,
    { backward = false }: { backward?: boolean } = {}
  ) {
    pages.innerHTML = `<p>${shown}</p>`;
    const node = pages.querySelector("p")?.firstChild as Text;
    const selection = document.getSelection() as Selection;
    if (backward) selection.setBaseAndExtent(node, to, node, from);
    else selection.setBaseAndExtent(node, from, node, to);
    return selectedSpan(
      text,
      selectionIn(pages) as Selection,
      pages,
      PAGE_NUMBER_CLASS
    );
  }

  /** `text` with each line break shown as a space, as across two lines. */
  const shownAs = (text: string) => text.replace(/\n/g, " ");

  test("a short selection across a line break maps to the text exactly", () => {
    const text = "alpha beta\ngamma delta";
    const span = spanOf(text, shownAs(text), 6, 16);
    expect(span).toEqual({ start: 6, end: 16 });
    expect(text.slice(span!.start, span!.end)).toBe("beta\ngamma");
  });

  test("a backward selection gives the span a forward one does", () => {
    const text = "alpha beta\ngamma delta";
    expect(spanOf(text, shownAs(text), 6, 16, { backward: true })).toEqual({
      start: 6,
      end: 16,
    });
    expect(spanOf(TEXT, TEXT, 3, 5, { backward: true })).toEqual({
      start: 3,
      end: 5,
    });
  });

  test("a selection whose tail repeats inside it keeps its whole end", () => {
    const half = "ab ".repeat(11) + "ab";
    const text = `start ${half}\n${half} end`;
    const length = half.length * 2 + 1;
    const span = spanOf(text, shownAs(text), 6, 6 + length);
    expect(span).toEqual({ start: 6, end: 6 + length });
  });

  test("of two occurrences, the one selected", () => {
    const text = "one two\nthree, and again one two\nthree.";
    const second = text.lastIndexOf("one");
    expect(spanOf(text, shownAs(text), second, second + 13)).toEqual({
      start: second,
      end: second + 13,
    });
    expect(spanOf(text, shownAs(text), 0, 13)).toEqual({ start: 0, end: 13 });
  });

  test("text found nowhere, however its whitespace is read, selects nothing", () => {
    expect(spanOf("alpha beta", "alpha  gamma", 0, 12)).toBeNull();
  });
});

test("selectionIn: only a selection of text that starts in the pages", () => {
  const outside = document.createElement("p");
  outside.textContent = "elsewhere";
  document.body.append(outside);
  const range = document.createRange();
  range.selectNodeContents(outside);
  document.getSelection()?.addRange(range);
  expect(selectionIn(pages)).toBeNull();
  outside.remove();
});
