# Demo

A page around `DocumentAnnotator` with controls of its own: the library ships
none. Published at <https://open-source-legal.github.io/react-contract-annotate/>
from `main` (`.github/workflows/pages.yml`).

```bash
# from the repository root
yarn build                             # the library the demo links to
yarn --cwd examples/demo install
yarn --cwd examples/demo dev
```

## Documents

Both are model agreements published by the U.S. National Institutes of Health
(Model 10-2015, Rev 09-2024), unmodified. As works of the U.S. Government they
are not subject to copyright in the United States (17 U.S.C. § 105).

| File under `public/documents/` | Published at |
|---|---|
| `patent-license/nih-patent-license-nonexclusive.pdf` | <https://www.techtransfer.nih.gov/sites/default/files/files/Model%20Agreements/NIH_Patent_License_Nonexclusive_model_102015_rev092024.pdf> |
| `evaluation-license/nih-commercial-evaluation-license.docx` | <https://www.techtransfer.nih.gov/sites/default/files/files/Model%20Agreements/NIH_Commercial_Evaluation_License_model_102015_rev092024.docx> |

## Data

Each document has an `export.json` beside it: an OpenContracts document export
(`OpenContractDocExport`), which the demo turns into viewer inputs with
`fromOpenContractsExport` and the labels in `public/documents/labels.json`. The
annotations and relationships in them are sample data written for the demo, not
legal analysis.

`scripts/make-exports.mjs` writes both exports from the documents:

```bash
node examples/demo/scripts/make-exports.mjs   # needs python3 with pdfplumber
```

- **PDF.** `scripts/make_pawls.py` reads the words of each page and their boxes
  (PAWLS tokens); the script finds each annotated passage among them.
- **DOCX.** docxodus exports the document's text and its structure (paragraphs
  and tables, kept as structural annotations); the script finds each annotated
  passage in that text.

A passage that is not found stops the run, and the output is the same on every
run.
