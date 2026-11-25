/**
 * Page indices that key a page-indexed record (annotation JSON, highlight
 * targets), as ascending integers. Keys that are not non-negative integers are
 * skipped, so a malformed host payload cannot inject `NaN` into the page list.
 */
export function sortedPageIndices(record: Record<number, unknown>): number[] {
  return Object.keys(record)
    .map(Number)
    .filter((index) => Number.isInteger(index) && index >= 0)
    .sort((a, b) => a - b);
}
