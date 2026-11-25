// Derives fixtures/eton/annotations.json and fixtures/eton/relations.json from
// fixtures/eton/pawls.json. Deterministic: re-running rewrites identical bytes.
//   node scripts/make-fixtures.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

const pawls = JSON.parse(readFileSync(root("fixtures/eton/pawls.json"), "utf8"));

// The presentation colour of OpenContracts' OC_URL label
// (OC_URL_LABEL_COLOR in frontend/src/assets/configurations/constants.ts,
// 98286cabf); the library itself has no use for it.
const urlColor = "#2563EB";

const LABELS = {
  exhibit: { id: "l-exhibit", text: "Exhibit", color: "#e11d48" },
  clause: { id: "l-clause", text: "Clause", color: "#2563eb" },
  para: { id: "l-para", text: "Paragraph", color: "#64748b" },
  url: { id: "l-url", text: "OC_URL", color: urlColor },
};

function pageTokens(pageIndex) {
  const page = pawls[pageIndex];
  if (!page) throw new Error(`pawls.json has no page ${pageIndex}`);
  return page.tokens;
}

/** Inclusive token range [from, to] on one page; throws when the page is too short. */
function tokenRange(pageIndex, from, to) {
  const count = pageTokens(pageIndex).length;
  if (to >= count) {
    throw new Error(`page ${pageIndex} has ${count} tokens, need index ${to}`);
  }
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** Spanning box: left = min x, top = min y, right = max(x + width), bottom = max(y + height). */
function spanningBounds(tokens) {
  return {
    top: Math.min(...tokens.map((t) => t.y)),
    left: Math.min(...tokens.map((t) => t.x)),
    right: Math.max(...tokens.map((t) => t.x + t.width)),
    bottom: Math.max(...tokens.map((t) => t.y + t.height)),
  };
}

const textOf = (tokens) => tokens.map((t) => t.text).join(" ");

/** v1 per-page json for the given token indices of one page. */
function v1Page(pageIndex, indices) {
  const tokens = pageTokens(pageIndex);
  const picked = indices.map((i) => tokens[i]);
  return {
    bounds: spanningBounds(picked),
    tokensJsons: indices.map((tokenIndex) => ({ pageIndex, tokenIndex })),
    rawText: textOf(picked),
  };
}

/** Token annotation over `spans` ({ page, from, to }, inclusive); `page` is the first span's page. */
function tokenAnnotation({ id, label, spans, structural, linkUrl }) {
  const json = {};
  for (const { page, from, to } of spans) {
    json[String(page)] = v1Page(page, tokenRange(page, from, to));
  }
  const rawText = spans.map(({ page }) => json[String(page)].rawText).join(" ");
  return {
    id,
    annotationLabel: label,
    rawText,
    page: spans[0].page,
    json,
    ...(structural ? { structural: true } : {}),
    ...(linkUrl ? { linkUrl } : {}),
  };
}

const multiFirstPage = 3;
const multiFirstPageTokenCount = pageTokens(multiFirstPage).length;

const aCompactTokens = tokenRange(2, 30, 45).map((i) => pageTokens(2)[i]);
const { top, left, right, bottom } = spanningBounds(aCompactTokens);

const aBadTokenFirst = pageTokens(0)[0];

const annotations = [
  tokenAnnotation({
    id: "a-title",
    label: LABELS.exhibit,
    spans: [{ page: 0, from: 0, to: 1 }],
  }),
  tokenAnnotation({
    id: "a-link",
    label: LABELS.url,
    spans: [{ page: 0, from: 5, to: 7 }],
    linkUrl: "https://example.com/terms",
  }),
  tokenAnnotation({
    id: "a-structural",
    label: LABELS.para,
    spans: [{ page: 1, from: 0, to: 40 }],
    structural: true,
  }),
  {
    id: "a-compact",
    annotationLabel: LABELS.clause,
    rawText: textOf(aCompactTokens),
    page: 2,
    json: { v: 2, p: { 2: { b: [top, left, right, bottom], t: "30-45" } } },
  },
  tokenAnnotation({
    id: "a-multi",
    label: LABELS.clause,
    spans: [
      { page: multiFirstPage, from: multiFirstPageTokenCount - 12, to: multiFirstPageTokenCount - 1 },
      { page: 4, from: 0, to: 11 },
    ],
  }),
  tokenAnnotation({
    id: "a-far",
    label: LABELS.exhibit,
    spans: [{ page: 17, from: 10, to: 24 }],
  }),
  // Deliberately invalid: token 999999 does not exist; bounds come from token 0 only.
  {
    id: "a-bad-token",
    annotationLabel: LABELS.clause,
    rawText: aBadTokenFirst.text,
    page: 0,
    json: {
      0: {
        bounds: spanningBounds([aBadTokenFirst]),
        tokensJsons: [
          { pageIndex: 0, tokenIndex: 0 },
          { pageIndex: 0, tokenIndex: 999999 },
        ],
        rawText: aBadTokenFirst.text,
      },
    },
  },
  // Deliberately invalid: the document has no page 500.
  {
    id: "a-bad-page",
    annotationLabel: LABELS.clause,
    rawText: "",
    page: 500,
    json: {
      500: {
        bounds: { top: 0, left: 0, right: 10, bottom: 10 },
        tokensJsons: [{ pageIndex: 500, tokenIndex: 0 }],
        rawText: "",
      },
    },
  },
];

const relations = [
  {
    id: "r-1",
    label: { id: "l-ref", text: "References" },
    sourceIds: ["a-title"],
    targetIds: ["a-far"],
  },
];

const write = (rel, value) =>
  writeFileSync(root(rel), `${JSON.stringify(value, null, 2)}\n`);

write("fixtures/eton/annotations.json", annotations);
write("fixtures/eton/relations.json", relations);

console.log(
  `${annotations.length} annotations, ${relations.length} relation${relations.length === 1 ? "" : "s"}`
);
