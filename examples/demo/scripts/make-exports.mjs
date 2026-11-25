// Writes the demo's data from its two documents (public/documents/**):
// an OpenContracts document export (`OpenContractDocExport`) per document,
// which the demo turns into viewer inputs with `fromOpenContractsExport`.
//
//   node examples/demo/scripts/make-exports.mjs
//
// Needs python3 with pdfplumber (make_pawls.py, the PDF's tokens) and the
// demo's node_modules (docxodus, the DOCX's text and structure).
// Deterministic: re-running rewrites identical bytes. Every passage below is
// looked up in the document, and a passage that is not found stops the run.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const demo = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

// Label names, as an export carries them. Their colours are in
// public/documents/labels.json (the corpus' `text_labels`).
const PARTIES = "Parties";
const DEFINED_TERM = "Defined Term";
const GRANT = "Grant of Rights";
const PAYMENT = "Payment";
const TERM = "Term and Termination";
const WARRANTY = "Warranty and Indemnity";
const GOVERNING_LAW = "Governing Law";
const STATUTE = "Statutory Reference";
const HEADING = "Section Heading";
const USES_TERM = "Uses defined term";
const SUBJECT_TO = "Subject to";

// ---------------------------------------------------------------------------
// PDF: NIH Patent License Agreement, Nonexclusive (token annotations)
// ---------------------------------------------------------------------------

/**
 * Each passage runs from the first token of `from` to the last token of `to`
 * (the first `to` at or after `from`) on a 0-based `page`; a passage that
 * continues on another page lists one such span per page.
 */
const PDF_PASSAGES = [
  {
    id: "parties-ic",
    label: PARTIES,
    spans: [{ page: 0, from: "The U.S. Department of Health", to: "of the NIH" }],
  },
  {
    id: "parties-licensee",
    label: PARTIES,
    spans: [
      {
        page: 0,
        from: "[Insert Company’s official name],",
        to: "[Insert State of Incorporation].",
      },
    ],
  },
  {
    id: "def-agreement",
    label: DEFINED_TERM,
    spans: [
      {
        page: 1,
        from: "This Patent License Agreement,",
        to: "(Royalty Payment Options).",
      },
    ],
  },
  {
    id: "statutory-authority",
    label: STATUTE,
    spans: [{ page: 2, from: "35 U.S.C. §§200-212,", to: "Part 404." }],
  },
  {
    id: "def-affiliates",
    label: DEFINED_TERM,
    spans: [{ page: 2, from: "“Affiliate(s)” means", to: "business entity." }],
  },
  {
    id: "def-first-commercial-sale",
    label: DEFINED_TERM,
    spans: [
      {
        page: 2,
        from: "“First Commercial Sale” means",
        to: "determining Net Sales.",
      },
    ],
  },
  {
    id: "def-government",
    label: DEFINED_TERM,
    spans: [{ page: 2, from: "“Government” means", to: "of America." }],
  },
  {
    id: "def-licensed-patent-rights",
    label: DEFINED_TERM,
    spans: [
      {
        page: 2,
        from: "“Licensed Patent Rights” shall mean:",
        to: "disclosed in 2.8(a):",
      },
      { page: 3, from: "(i) continuations-in-part", to: "disclosed in 2.8(a)." },
    ],
  },
  {
    id: "def-licensed-products",
    label: DEFINED_TERM,
    spans: [
      { page: 3, from: "“Licensed Products” means", to: "competent jurisdiction." },
    ],
  },
  {
    id: "def-net-sales",
    label: DEFINED_TERM,
    spans: [{ page: 3, from: "“Net Sales” means", to: "a third party." }],
  },
  {
    id: "grant",
    label: GRANT,
    spans: [{ page: 3, from: "The IC hereby grants", to: "Fields of Use." }],
  },
  {
    id: "no-sublicense",
    label: GRANT,
    spans: [{ page: 4, from: "The Licensee has no right", to: "to sublicense." }],
  },
  {
    id: "issue-royalty",
    label: PAYMENT,
    spans: [
      {
        page: 4,
        from: "The Licensee agrees to pay the IC a noncreditable,",
        to: "Appendix C.",
      },
    ],
  },
  {
    id: "patent-expenses",
    label: PAYMENT,
    spans: [
      {
        page: 4,
        from: "With regard to unreimbursed expenses",
        to: "previously paid by the IC.",
      },
    ],
  },
  {
    id: "warranty-disclaimer",
    label: WARRANTY,
    spans: [{ page: 8, from: "THE IC MAKES NO WARRANTIES,", to: "THERETO." }],
  },
  {
    id: "indemnity",
    label: WARRANTY,
    spans: [
      {
        page: 8,
        from: "The Licensee shall indemnify",
        to: "of the Licensed Patent Rights.",
      },
    ],
  },
  {
    id: "term",
    label: TERM,
    spans: [
      {
        page: 8,
        from: "This Agreement is effective when signed",
        to: "this Article 13.",
      },
    ],
  },
  {
    id: "termination-for-default",
    label: TERM,
    spans: [
      {
        page: 8,
        from: "In the event that the Licensee is in default",
        to: "Debt Collection Act.",
      },
    ],
  },
  {
    id: "termination-by-licensee",
    label: TERM,
    spans: [
      {
        page: 8,
        from: "The Licensee shall have a unilateral right",
        to: "to that effect.",
      },
    ],
  },
  {
    id: "governing-law",
    label: GOVERNING_LAW,
    spans: [
      { page: 10, from: "The construction, validity,", to: "District of Columbia." },
    ],
  },
];

/** The article headings, as structural annotations: [0-based page, heading]. */
const PDF_HEADINGS = [
  [2, "1. BACKGROUND"],
  [2, "2. DEFINITIONS"],
  [3, "3. GRANT OF RIGHTS"],
  [4, "4. SUBLICENSING"],
  [4, "5. STATUTORY AND NIH REQUIREMENTS AND RESERVED GOVERNMENT RIGHTS"],
  [4, "6. ROYALTIES AND REIMBURSEMENT"],
  [5, "7. PATENT FILING, PROSECUTION, AND MAINTENANCE"],
  [5, "8. RECORD KEEPING"],
  [6, "9. REPORTS ON PROGRESS, BENCHMARKS, SALES, AND PAYMENTS"],
  [7, "10. PERFORMANCE"],
  [7, "11. INFRINGEMENT AND PATENT ENFORCEMENT"],
  [7, "12. NEGATION OF WARRANTIES AND INDEMNIFICATION"],
  [8, "13. TERM, TERMINATION, AND MODIFICATION OF RIGHTS"],
  [9, "14. GENERAL PROVISIONS"],
];

const PDF_RELATIONSHIPS = [
  {
    id: "rel-grant-terms",
    relationshipLabel: USES_TERM,
    source_annotation_ids: ["grant"],
    target_annotation_ids: ["def-licensed-patent-rights", "def-licensed-products"],
  },
  {
    id: "rel-first-sale-terms",
    relationshipLabel: USES_TERM,
    source_annotation_ids: ["def-first-commercial-sale"],
    target_annotation_ids: ["def-licensed-products", "def-net-sales"],
  },
  {
    id: "rel-term-termination",
    relationshipLabel: SUBJECT_TO,
    source_annotation_ids: ["term"],
    target_annotation_ids: ["termination-for-default", "termination-by-licensee"],
  },
];

const words = (phrase) => phrase.split(/\s+/);

/** Index of the first run of `phrase`'s words in `tokens` at or after `start`. */
function findWords(tokens, phrase, start, where) {
  const wanted = words(phrase);
  for (let i = start; i + wanted.length <= tokens.length; i++) {
    if (wanted.every((word, k) => tokens[i + k].text === word)) return i;
  }
  throw new Error(`${where}: "${phrase}" not found`);
}

/** OpenContracts' per-page token annotation json for tokens [first, last]. */
function pageJson(page, first, last) {
  const picked = page.tokens.slice(first, last + 1);
  return {
    bounds: {
      top: Math.min(...picked.map((t) => t.y)),
      left: Math.min(...picked.map((t) => t.x)),
      right: Math.max(...picked.map((t) => t.x + t.width)),
      bottom: Math.max(...picked.map((t) => t.y + t.height)),
    },
    tokensJsons: picked.map((_, k) => ({
      pageIndex: page.page.index,
      tokenIndex: first + k,
    })),
    rawText: picked.map((t) => t.text).join(" "),
  };
}

function tokenAnnotation(pawls, { id, label, spans }, structural) {
  const json = {};
  for (const { page, from, to } of spans) {
    const pawlsPage = pawls[page];
    const where = `${id} (page ${page})`;
    const first = findWords(pawlsPage.tokens, from, 0, where);
    const last =
      findWords(pawlsPage.tokens, to, first, where) + words(to).length - 1;
    json[String(page)] = pageJson(pawlsPage, first, last);
  }
  return {
    id,
    annotationLabel: label,
    rawText: spans.map(({ page }) => json[String(page)].rawText).join(" "),
    page: spans[0].page,
    annotation_json: json,
    structural,
  };
}

function pdfExport() {
  const pawls = JSON.parse(
    execFileSync("python3", [demo("scripts/make_pawls.py")], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
  );
  const headings = PDF_HEADINGS.map(([page, heading]) =>
    tokenAnnotation(
      pawls,
      {
        id: `heading-${Number.parseInt(heading, 10)}`,
        label: HEADING,
        spans: [{ page, from: heading, to: heading }],
      },
      true
    )
  );
  const passages = PDF_PASSAGES.map((passage) =>
    tokenAnnotation(pawls, passage, false)
  );
  return {
    title: "Public Health Service Patent License Agreement – Nonexclusive",
    content: pawls
      .map((page) => page.tokens.map((t) => t.text).join(" "))
      .join("\n"),
    description:
      "NIH model agreement, Model 10-2015, Rev 09-2024 (U.S. Government work).",
    pawls_file_content: pawls,
    page_count: pawls.length,
    doc_labels: [],
    labelled_text: [...headings, ...passages],
    relationships: PDF_RELATIONSHIPS,
  };
}

// ---------------------------------------------------------------------------
// DOCX: NIH Commercial Evaluation License Agreement (span annotations)
// ---------------------------------------------------------------------------

/**
 * Each passage runs from the start of `from` to the end of `to` (the first
 * `to` at or after `from`; `from` alone when there is no `to`) in the text
 * docxodus exports, and stays inside one paragraph.
 */
const DOCX_PASSAGES = [
  {
    id: "parties-ic",
    label: PARTIES,
    from: "The U.S. Department of Health and Human Services, as represented by",
  },
  {
    id: "parties-licensee",
    label: PARTIES,
    from: "hereinafter referred to as the “Licensee”,",
  },
  {
    id: "def-government",
    label: DEFINED_TERM,
    from: "“Government” means",
    to: "of America.",
  },
  {
    id: "def-licensed-patent-rights",
    label: DEFINED_TERM,
    from: "“Licensed Patent Rights” means",
    to: "and all foreign counterparts",
  },
  {
    id: "def-materials",
    label: DEFINED_TERM,
    from: "“Materials” means",
    to: "derivatives thereof.",
  },
  {
    id: "def-licensed-products",
    label: DEFINED_TERM,
    from: "“Licensed Products” means",
    to: "Licensed Patent Rights.",
  },
  {
    id: "grant",
    label: GRANT,
    from: "The IC hereby grants to the Licensee",
    to: "in the Licensed Field of Use.",
  },
  {
    id: "evaluation-only",
    label: GRANT,
    from: "The rights provided herein",
    to: "not for commercial use.",
  },
  {
    id: "issue-royalty",
    label: PAYMENT,
    from: "The Licensee hereby agrees to pay the IC a license issue royalty",
    to: "effective date of this Agreement.",
  },
  {
    id: "late-payment",
    label: PAYMENT,
    from: "Additional royalties may be assessed",
    to: "one percent (1%) per month.",
  },
  {
    id: "term",
    label: TERM,
    from: "This Agreement shall become effective",
    to: "months from its effective date.",
  },
  {
    id: "termination-for-default",
    label: TERM,
    from: "In the event that the Licensee is in default",
    to: "by written notice.",
  },
  {
    id: "warranty-disclaimer",
    label: WARRANTY,
    from: "NO WARRANTIES, EXPRESS OR IMPLIED,",
    to: "INFRINGING OTHER PATENT RIGHTS.",
  },
  {
    id: "indemnity",
    label: WARRANTY,
    from: "The Licensee agrees to indemnify and hold harmless",
    to: "or the Materials.",
  },
  {
    id: "governing-law",
    label: GOVERNING_LAW,
    from: "This Agreement shall be construed in accordance with U.S. Federal law,",
    to: "District of Columbia.",
  },
];

const DOCX_RELATIONSHIPS = [
  {
    id: "rel-grant-terms",
    relationshipLabel: USES_TERM,
    source_annotation_ids: ["grant"],
    target_annotation_ids: [
      "def-licensed-patent-rights",
      "def-materials",
      "def-licensed-products",
    ],
  },
  {
    id: "rel-term-termination",
    relationshipLabel: SUBJECT_TO,
    source_annotation_ids: ["term"],
    target_annotation_ids: ["termination-for-default"],
  },
];

/** docxodus' structural labels worth drawing: a section spans whole pages. */
const DOCX_STRUCTURAL_LABELS = new Set(["PARAGRAPH", "TABLE"]);

function spanAnnotation(content, { id, label, from, to }) {
  const start = content.indexOf(from);
  if (start < 0) throw new Error(`${id}: "${from}" not found`);
  const tail = to ?? from;
  const tailStart = content.indexOf(tail, start);
  if (tailStart < 0) throw new Error(`${id}: "${tail}" not found`);
  const end = tailStart + tail.length;
  const text = content.slice(start, end);
  if (text.includes("\n")) throw new Error(`${id}: spans two paragraphs`);
  return {
    id,
    annotationLabel: label,
    rawText: text,
    page: 0,
    annotation_json: { start, end, text },
    structural: false,
  };
}

async function docxExport() {
  // The package's main entry also loads its editor, which needs a browser.
  const docxodus = await import(
    new URL("../node_modules/docxodus/dist/core.js", import.meta.url).href
  );
  await docxodus.initialize(demo("node_modules/docxodus/dist/wasm/"));
  const exported = await docxodus.exportToOpenContract(
    new Uint8Array(
      readFileSync(
        demo(
          "public/documents/evaluation-license/nih-commercial-evaluation-license.docx"
        )
      )
    )
  );
  const content = exported.content;
  // docxodus' own structure (paragraphs and tables), which carries no text:
  // the text of each is the part of `content` its offsets name.
  const structure = exported.labelledText
    .filter(
      (item) =>
        DOCX_STRUCTURAL_LABELS.has(item.annotationLabel) &&
        item.annotationJson.end > item.annotationJson.start
    )
    .map((item) => {
      const { start, end } = item.annotationJson;
      const text = content.slice(start, end);
      return {
        id: item.id,
        annotationLabel: item.annotationLabel,
        rawText: text,
        page: 0,
        annotation_json: { start, end, text },
        structural: true,
      };
    });
  return {
    title: "Public Health Service Commercial Evaluation License Agreement",
    content,
    description:
      "NIH model agreement, Model 10-2015, Rev 09-2024 (U.S. Government work).",
    pawls_file_content: [],
    page_count: exported.pageCount,
    doc_labels: [],
    labelled_text: [
      ...structure,
      ...DOCX_PASSAGES.map((passage) => spanAnnotation(content, passage)),
    ],
    relationships: DOCX_RELATIONSHIPS,
  };
}

// ---------------------------------------------------------------------------

function write(rel, doc) {
  writeFileSync(demo(rel), `${JSON.stringify(doc)}\n`);
  const own = doc.labelled_text.filter((item) => !item.structural).length;
  console.log(
    `${rel}: ${doc.page_count} pages, ${own} annotations, ` +
      `${doc.labelled_text.length - own} structural, ` +
      `${doc.relationships.length} relationships`
  );
}

write("public/documents/patent-license/export.json", pdfExport());
write("public/documents/evaluation-license/export.json", await docxExport());
