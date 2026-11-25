"""Derives the extra DOCX fixtures from fixtures/docx/test.docx.

- landscape.docx (+ landscape.txt): a second, different document for the
  isolation tests: a landscape page, half-inch margins, a 16pt Arial Normal
  style and two paragraphs of its own text.
- hostile-font.docx: test.docx with a crafted font name in its Normal style
  that, emitted unescaped into the converted document's stylesheet by
  docxodus, ends the font-family string at its line break and opens rules of
  its own (`} body { display: none } .z { a: `). Same text as test.docx.

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


def hostile_styles(source: str) -> str:
    return with_normal_run_properties(
        source, f'<w:rFonts w:ascii="{HOSTILE_FONT}" w:hAnsi="{HOSTILE_FONT}"/>'
    )


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
    derive("hostile-font.docx", {"word/styles.xml": hostile_styles})


if __name__ == "__main__":
    main()
