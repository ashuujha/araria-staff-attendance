"""Export saved staff credentials to a private XLSX using only the stdlib."""
import csv
import json
import os
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / "private"
OUTPUT = PRIVATE / "ALL STAFF LOGIN DETAILS.xlsx"
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def column(number):
    name = ""
    while number:
        number, rem = divmod(number - 1, 26)
        name = chr(65 + rem) + name
    return name


def sheet(rows, widths):
    xml = [f'<worksheet xmlns="{NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>']
    for i, width in enumerate(widths, 1):
        xml.append(f'<col min="{i}" max="{i}" width="{width}" customWidth="1"/>')
    xml.append('</cols><sheetData>')
    for r, values in enumerate(rows, 1):
        xml.append(f'<row r="{r}">')
        for c, value in enumerate(values, 1):
            # Inline strings preserve phone numbers and passwords exactly, and
            # prevent Excel from treating personnel data as executable formulas.
            text = escape(str(value))
            xml.append(f'<c r="{column(c)}{r}" t="inlineStr" s="{1 if r == 1 else 2}"><is><t xml:space="preserve">{text}</t></is></c>')
        xml.append('</row>')
    xml.append(f'</sheetData><autoFilter ref="A1:{column(len(rows[0]))}{len(rows)}"/></worksheet>')
    return ''.join(xml)


def main():
    source = json.loads((PRIVATE / "staff-import.json").read_text())
    credentials = {}
    files = sorted(PRIVATE.glob("credentials-*.csv"), key=lambda p: p.stat().st_mtime)
    for path in files:
        with path.open(encoding="utf-8-sig", newline="") as stream:
            for item in csv.DictReader(stream):
                if item.get("login") and item.get("password"):
                    credentials[item["login"]] = item
    rows = [["No.", "Staff name", "Mobile number", "Email", "Login ID", "Password", "Login role", "Block", "Panchayat", "Position", "Website"]]
    missing = 0
    for person in sorted(source["staff"], key=lambda p: p["name"]):
        login = person["phones"][0] if person["phones"] else person["email"]
        credential = credentials.get(login)
        if not credential or credential["name"] != person["name"]:
            missing += 1
            continue
        assignments = person["assignments"]
        rows.append([
            str(len(rows)), person["name"], credential["phone"], credential["email"],
            credential["login"], credential["password"], "Staff",
            person.get("block", "Araria"),
            '\n'.join(a.get("panchayat", "") for a in assignments),
            '\n'.join(a.get("position", "") for a in assignments),
            "https://araria-staff-attendance.vercel.app",
        ])
    if missing:
        raise SystemExit(f"Export stopped: {missing} staff accounts lack matching saved credentials. No passwords were guessed or reset.")
    notes = [
        ["Item", "Details"],
        ["Accounts", str(len(rows) - 1)],
        ["How to log in", "Open the website, select Staff, enter Login ID and Password."],
        ["Password source", "Saved account-provisioning credentials. Later password changes are not reflected in this file."],
        ["Assignments", "Each line in Department, Panchayat and Position belongs to the same assignment."],
        ["Distribution", "Give each staff member their own login row."],
    ]
    styles = f'''<styleSheet xmlns="{NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF245D88"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'''
    parts = {
        "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": f'<workbook xmlns="{NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Staff Logins" sheetId="1" r:id="rId1"/><sheet name="Instructions" sheetId="2" r:id="rId2"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        "xl/styles.xml": styles,
        "xl/worksheets/sheet1.xml": sheet(rows, [6, 30, 18, 30, 26, 28, 12, 32, 32, 28, 48]),
        "xl/worksheets/sheet2.xml": sheet(notes, [24, 100]),
    }
    temporary = OUTPUT.with_suffix(".xlsx.tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as stream:
        with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, content in parts.items():
                archive.writestr(name, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + content)
    temporary.chmod(0o600)
    temporary.replace(OUTPUT)
    print(f"Saved {len(rows) - 1} staff login rows to {OUTPUT}")


if __name__ == "__main__":
    main()
