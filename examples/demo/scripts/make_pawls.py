"""PAWLS tokens of the demo's PDF: one page per PDF page, one token per word,
in PDF points from the page's top-left corner (what the viewer scales by its
zoom).

Printed as JSON on standard output for `make-exports.mjs`, which runs this
script and writes the document's export from it. Needs `pip install pdfplumber`.
Deterministic: the same PDF gives the same bytes.
"""

import json
import sys
from pathlib import Path

import pdfplumber

PDF = (
    Path(__file__).resolve().parent.parent
    / "public/documents/patent-license/nih-patent-license-nonexclusive.pdf"
)

# Characters closer than this (in points) are one word; lines are told apart
# by this much vertical distance.
X_TOLERANCE = 1.5
Y_TOLERANCE = 3
# Sub-point precision the viewer can show; keeps the file small.
DECIMALS = 2


def token(word: dict) -> dict:
    return {
        "x": round(word["x0"], DECIMALS),
        "y": round(word["top"], DECIMALS),
        "width": round(word["x1"] - word["x0"], DECIMALS),
        "height": round(word["bottom"] - word["top"], DECIMALS),
        "text": word["text"],
    }


def main() -> None:
    pages = []
    with pdfplumber.open(PDF) as pdf:
        for index, page in enumerate(pdf.pages):
            words = page.extract_words(x_tolerance=X_TOLERANCE, y_tolerance=Y_TOLERANCE)
            pages.append(
                {
                    "page": {"width": float(page.width), "height": float(page.height), "index": index},
                    "tokens": [token(word) for word in words],
                }
            )
    json.dump(pages, sys.stdout, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
