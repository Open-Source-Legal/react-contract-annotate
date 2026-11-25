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
