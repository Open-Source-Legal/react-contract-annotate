"""Derives fixtures/docx/landscape.docx and landscape.txt from test.docx.

A second, different document for the DOCX isolation tests: the same package
with a landscape page, half-inch margins, a 16pt Arial Normal style and two
paragraphs of its own text. Deterministic: re-running writes identical bytes.

    python3 scripts/make-docx-landscape.py
"""
import re
import zipfile
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures" / "docx"
PARAGRAPHS = [
    "Second document on a landscape page.",
    "Its Normal style is sixteen point Arial.",
]


def document_xml(source: str) -> str:
    runs = "".join(f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>" for text in PARAGRAPHS)
    body = re.sub(r"<w:body>.*?(<w:sectPr)", lambda m: f"<w:body>{runs}{m.group(1)}", source, flags=re.S)
    body = re.sub(r'<w:pgSz [^>]*/>', '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>', body)
    return re.sub(
        r'<w:pgMar [^>]*/>',
        '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>',
        body,
    )


def styles_xml(source: str) -> str:
    normal = '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>'
    assert normal in source, "Normal style not found"
    return source.replace(
        normal,
        normal + '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>',
    )


def main() -> None:
    with zipfile.ZipFile(FIXTURES / "test.docx") as source, zipfile.ZipFile(
        FIXTURES / "landscape.docx", "w", zipfile.ZIP_DEFLATED
    ) as target:
        for info in source.infolist():
            data = source.read(info.filename)
            if info.filename == "word/document.xml":
                data = document_xml(data.decode("utf-8")).encode("utf-8")
            elif info.filename == "word/styles.xml":
                data = styles_xml(data.decode("utf-8")).encode("utf-8")
            target.writestr(zipfile.ZipInfo(info.filename, date_time=info.date_time), data, zipfile.ZIP_DEFLATED)
    (FIXTURES / "landscape.txt").write_text("".join(f"{text}\n" for text in PARAGRAPHS), encoding="utf-8")


if __name__ == "__main__":
    main()
