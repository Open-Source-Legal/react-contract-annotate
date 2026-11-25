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
- hyperlink.docx (+ hyperlink.txt): test.docx with a body of its own whose
  hyperlinks go to an absolute `https` URL, a relative URL, a `mailto` URL
  and a bookmark in the document.
- features.docx: test.docx with a body of its own that exercises what
  docxodus converts besides plain paragraphs: a title and headings, bold,
  italic, underlined, struck, superscript and subscript runs, a tab, a line
  break, list items, a table with a header row and merged cells, an image and
  a page break. For the sanitiser's parity check.

Deterministic: re-running writes identical bytes.

    python3 scripts/make-docx-fixtures.py
"""
import re
import struct
import zipfile
import zlib
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
HYPERLINK_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
# (relationship id, target) of each external hyperlink of hyperlink.docx.
HYPERLINK_TARGETS = [
    ("rIdLinkAbsolute", "https://example.invalid/docx-link"),
    ("rIdLinkRelative", "docx-relative.html"),
    ("rIdLinkMail", "mailto:legal@example.invalid"),
]
BOOKMARK = "Definitions"
# Each paragraph of hyperlink.docx: (text, link) runs; a link is a relationship
# id (an external hyperlink), `#` and a bookmark name (a hyperlink to it), or
# `@` and a bookmark name (the run is that bookmark).
HYPERLINK_PARAGRAPHS = [
    [("Read the terms at the ", None), ("example site", "rIdLinkAbsolute"), (".", None)],
    [("See the ", None), ("relative page", "rIdLinkRelative"), (" or ", None), ("write to us", "rIdLinkMail"), (".", None)],
    [("Jump to the ", None), ("definitions", f"#{BOOKMARK}"), (" below.", None)],
    [("Definitions follow here.", f"@{BOOKMARK}")],
]


IMAGE_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
IMAGE_ID = "rIdFeatureImage"
IMAGE_PART = "word/media/image1.png"
# EMU per inch: the image is one inch square.
IMAGE_EMU = 914400


def text_run(text: str, properties: str = "") -> str:
    rpr = f"<w:rPr>{properties}</w:rPr>" if properties else ""
    return f'<w:r>{rpr}<w:t xml:space="preserve">{text}</w:t></w:r>'


def styled_paragraph(style: str, text: str) -> str:
    return f'<w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr>{text_run(text)}</w:p>'


def list_paragraph(level: int, text: str) -> str:
    return (
        '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/>'
        f'<w:numPr><w:ilvl w:val="{level}"/><w:numId w:val="1"/></w:numPr></w:pPr>{text_run(text)}</w:p>'
    )


def table_cell(text: str, properties: str = "") -> str:
    return f'<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>{properties}</w:tcPr><w:p>{text_run(text)}</w:p></w:tc>'


def png_pixel() -> bytes:
    """A 1x1 red PNG."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    header = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00"))
        + chunk(b"IEND", b"")
    )


def inline_image() -> str:
    extent = f'cx="{IMAGE_EMU}" cy="{IMAGE_EMU}"'
    return (
        '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent {extent}/><wp:docPr id="1" name="Picture 1" descr="a red dot"/>'
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
        '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        '<pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr>'
        f'<pic:blipFill><a:blip r:embed="{IMAGE_ID}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext {extent}/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
        "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"
    )


def features_document(source: str) -> str:
    runs = "".join(
        text_run(text, properties)
        for text, properties in [
            ("bold ", "<w:b/>"),
            ("italic ", "<w:i/>"),
            ("underlined ", '<w:u w:val="single"/>'),
            ("struck ", "<w:strike/>"),
            ("super", '<w:vertAlign w:val="superscript"/>'),
            ("sub", '<w:vertAlign w:val="subscript"/>'),
        ]
    )
    table = (
        '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>'
        '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>'
        f'<w:tr><w:trPr><w:tblHeader/></w:trPr>{table_cell("Term")}{table_cell("Meaning")}</w:tr>'
        f'<w:tr>{table_cell("Spanning both columns", "<w:gridSpan w:val=\"2\"/>")}</w:tr>'
        f'<w:tr>{table_cell("Spanning two rows", "<w:vMerge w:val=\"restart\"/>")}{table_cell("first")}</w:tr>'
        f'<w:tr>{table_cell("", "<w:vMerge/>")}{table_cell("second")}</w:tr></w:tbl>'
    )
    paragraphs = (
        styled_paragraph("Title", "Features")
        + "".join(styled_paragraph(f"Heading{level}", f"Heading {level}") for level in (1, 2))
        + f"<w:p>{runs}<w:r><w:tab/></w:r>{text_run('after a tab')}<w:r><w:br/></w:r>{text_run('after a break')}</w:p>"
        + list_paragraph(0, "First item")
        + list_paragraph(1, "Nested item")
        + table
        + f"<w:p>{inline_image()}{text_run(' after an image')}</w:p>"
        + f'<w:p><w:r><w:br w:type="page"/></w:r>{text_run("After a page break.")}</w:p>'
    )
    return with_body(source, paragraphs)


def features_relationships(source: str) -> str:
    relationship = f'<Relationship Id="{IMAGE_ID}" Type="{IMAGE_TYPE}" Target="media/image1.png"/>'
    assert "</Relationships>" in source, "relationships element not found"
    return source.replace("</Relationships>", relationship + "</Relationships>")


def features_content_types(source: str) -> str:
    png = '<Default Extension="png" ContentType="image/png"/>'
    anchor = '<Default Extension="jpeg"'
    assert anchor in source, "content types not found"
    return source.replace(anchor, png + anchor)


def with_body(source: str, paragraphs: str) -> str:
    return re.sub(r"<w:body>.*?(<w:sectPr)", lambda m: f"<w:body>{paragraphs}{m.group(1)}", source, flags=re.S)


def landscape_document(source: str) -> str:
    runs = "".join(f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>" for text in LANDSCAPE_PARAGRAPHS)
    body = with_body(source, runs)
    body = re.sub(r'<w:pgSz [^>]*/>', '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>', body)
    return re.sub(
        r'<w:pgMar [^>]*/>',
        '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>',
        body,
    )


def hyperlink_run(text: str, link) -> str:
    run = f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r>'
    if link is None:
        return run
    if link.startswith("@"):
        return f'<w:bookmarkStart w:id="0" w:name="{link[1:]}"/>{run}<w:bookmarkEnd w:id="0"/>'
    styled = f'<w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>'
    if link.startswith("#"):
        return f'<w:hyperlink w:anchor="{link[1:]}">{styled}</w:hyperlink>'
    return f'<w:hyperlink r:id="{link}">{styled}</w:hyperlink>'


def hyperlink_document(source: str) -> str:
    paragraphs = "".join(
        "<w:p>" + "".join(hyperlink_run(text, link) for text, link in runs) + "</w:p>"
        for runs in HYPERLINK_PARAGRAPHS
    )
    return with_body(source, paragraphs)


def hyperlink_relationships(source: str) -> str:
    relationships = "".join(
        f'<Relationship Id="{rid}" Type="{HYPERLINK_TYPE}" Target="{target}" TargetMode="External"/>'
        for rid, target in HYPERLINK_TARGETS
    )
    assert "</Relationships>" in source, "relationships element not found"
    return source.replace("</Relationships>", relationships + "</Relationships>")


def with_normal_run_properties(source: str, run_properties: str) -> str:
    assert NORMAL_STYLE in source, "Normal style not found"
    return source.replace(NORMAL_STYLE, NORMAL_STYLE + f"<w:rPr>{run_properties}</w:rPr>")


def landscape_styles(source: str) -> str:
    return with_normal_run_properties(
        source, '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="32"/><w:szCs w:val="32"/>'
    )


def font_styles(font: str):
    return lambda source: with_normal_run_properties(source, f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}"/>')


def derive(target_name: str, rewrite: dict, added: dict | None = None) -> None:
    """test.docx with parts rewritten, and parts `added` (dated as its main part)."""
    with zipfile.ZipFile(FIXTURES / "test.docx") as source, zipfile.ZipFile(
        FIXTURES / target_name, "w", zipfile.ZIP_DEFLATED
    ) as target:
        for info in source.infolist():
            data = source.read(info.filename)
            if info.filename in rewrite:
                data = rewrite[info.filename](data.decode("utf-8")).encode("utf-8")
            target.writestr(zipfile.ZipInfo(info.filename, date_time=info.date_time), data, zipfile.ZIP_DEFLATED)
        date_time = source.getinfo("word/document.xml").date_time
        for name, data in (added or {}).items():
            target.writestr(zipfile.ZipInfo(name, date_time=date_time), data, zipfile.ZIP_DEFLATED)


def main() -> None:
    derive("landscape.docx", {"word/document.xml": landscape_document, "word/styles.xml": landscape_styles})
    (FIXTURES / "landscape.txt").write_text("".join(f"{text}\n" for text in LANDSCAPE_PARAGRAPHS), encoding="utf-8")
    derive("hostile-font.docx", {"word/styles.xml": font_styles(HOSTILE_FONT)})
    derive("hostile-overlay.docx", {"word/styles.xml": font_styles(OVERLAY_FONT)})
    derive("hostile-fetch.docx", {"word/styles.xml": font_styles(FETCH_FONT)})
    derive("hostile-counter.docx", {"word/styles.xml": font_styles(COUNTER_FONT)})
    derive(
        "hyperlink.docx",
        {"word/document.xml": hyperlink_document, "word/_rels/document.xml.rels": hyperlink_relationships},
    )
    (FIXTURES / "hyperlink.txt").write_text(
        "".join("".join(text for text, _ in runs) + "\n" for runs in HYPERLINK_PARAGRAPHS), encoding="utf-8"
    )
    derive(
        "features.docx",
        {
            "word/document.xml": features_document,
            "word/_rels/document.xml.rels": features_relationships,
            "[Content_Types].xml": features_content_types,
        },
        {IMAGE_PART: png_pixel()},
    )


if __name__ == "__main__":
    main()
