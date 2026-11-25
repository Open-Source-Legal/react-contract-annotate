"""Derives the extra DOCX fixtures from fixtures/docx/test.docx.

- landscape.docx (+ landscape.txt): a second, different document for the
  isolation tests: a landscape page, half-inch margins, a 16pt Arial Normal
  style and two paragraphs of its own text.
- hostile-font.docx: test.docx with a crafted font name in its Normal style
  that, emitted unescaped into the converted document's stylesheet by
  docxodus, ends the font-family string at its line break and opens rules of
  its own (`} body { display: none } .z { a: `). Same text as test.docx.
- hostile-overlay.docx: the same trick with a `body` rule that would cover
  the whole page (fixed, inset 0, the highest z-index, a red background).
- hostile-fetch.docx: the same trick with rules, for the paragraphs and for
  the projected annotations, whose `background-image` hides a `url()` in the
  fallback of a substitution function, its name spelt with a CSS escape
  (`env(x, u\72l(https://example.invalid/…))`).
- hostile-counter.docx: the same trick with a rule making every paragraph a
  list item that also increments a counter named `host`.

Deterministic: re-running writes identical bytes.

    python3 scripts/make-docx-fixtures.py
"""
import re
import zipfile
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures" / "docx"
LANDSCAPE_PARAGRAPHS = [
    "Second document on a landscape page.",
    "Its Normal style is sixteen point Arial.",
]
# `&#10;` is a line feed in the attribute value.
HOSTILE_FONT = "Evil&#10;} body { display: none } .z { a: "
OVERLAY_FONT = (
    "Evil&#10;} body { position: fixed !important; inset: 0 !important; "
    "z-index: 2147483647 !important; background: red !important } .z { a: "
)
# `&quot;` is a double quote in the attribute value.
FETCH_FONT = (
    "Evil&#10;} p { background-image: env(x, u\\72l(https://example.invalid/docx-env)) } "
    "[data-annotation-id^=&quot;d&quot;] { background-image: "
    "env(x, u\\72l(https://example.invalid/docx-env-annotation)) } .z { a: "
)
COUNTER_FONT = "Evil&#10;} p { display: list-item !important; counter-increment: host 5 } .z { a: "
NORMAL_STYLE = '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>'


def landscape_document(source: str) -> str:
    runs = "".join(f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>" for text in LANDSCAPE_PARAGRAPHS)
    body = re.sub(r"<w:body>.*?(<w:sectPr)", lambda m: f"<w:body>{runs}{m.group(1)}", source, flags=re.S)
    body = re.sub(r'<w:pgSz [^>]*/>', '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>', body)
    return re.sub(
        r'<w:pgMar [^>]*/>',
        '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>',
        body,
    )


def with_normal_run_properties(source: str, run_properties: str) -> str:
    assert NORMAL_STYLE in source, "Normal style not found"
    return source.replace(NORMAL_STYLE, NORMAL_STYLE + f"<w:rPr>{run_properties}</w:rPr>")


def landscape_styles(source: str) -> str:
    return with_normal_run_properties(
        source, '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="32"/><w:szCs w:val="32"/>'
    )


def font_styles(font: str):
    return lambda source: with_normal_run_properties(source, f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}"/>')


def derive(target_name: str, rewrite: dict) -> None:
    with zipfile.ZipFile(FIXTURES / "test.docx") as source, zipfile.ZipFile(
        FIXTURES / target_name, "w", zipfile.ZIP_DEFLATED
    ) as target:
        for info in source.infolist():
            data = source.read(info.filename)
            if info.filename in rewrite:
                data = rewrite[info.filename](data.decode("utf-8")).encode("utf-8")
            target.writestr(zipfile.ZipInfo(info.filename, date_time=info.date_time), data, zipfile.ZIP_DEFLATED)


def main() -> None:
    derive("landscape.docx", {"word/document.xml": landscape_document, "word/styles.xml": landscape_styles})
    (FIXTURES / "landscape.txt").write_text("".join(f"{text}\n" for text in LANDSCAPE_PARAGRAPHS), encoding="utf-8")
    derive("hostile-font.docx", {"word/styles.xml": font_styles(HOSTILE_FONT)})
    derive("hostile-overlay.docx", {"word/styles.xml": font_styles(OVERLAY_FONT)})
    derive("hostile-fetch.docx", {"word/styles.xml": font_styles(FETCH_FONT)})
    derive("hostile-counter.docx", {"word/styles.xml": font_styles(COUNTER_FONT)})


if __name__ == "__main__":
    main()
