# PDF-Testdateien für `npm run test:vecformats`

Alle Dateien sind eigens für die Tests erzeugt und enthalten nur kurze Beispieltexte.

| Datei | Erzeugt mit | Inhalt |
|---|---|---|
| `text-cff.pdf` | von Hand (Python) | Inter Bold als CFF-Teilmenge (pyftsubset): Type1C, CIDFontType0C mit Identity-H, OpenType |
| `text-rl.pdf` | reportlab | Liberation Sans (TrueType, eingebettet), Bitstream Charter (Type 1, eingebettet), Helvetica (nicht eingebettet) |
| `text-chrome.pdf` | Chromium (Druck als PDF) | Inter als Type-3-Schrift, DejaVu Serif als CID-TrueType, gedrehter Text |
| `enc-*.pdf` | pikepdf/qpdf | einfache Zeichnung mit Bearbeitungsschutz: RC4 40 Bit, RC4 128 Bit, AES-128, AES-256 (R6); `enc-userpw.pdf` mit Kennwort zum Öffnen |

Schriftlizenzen: Inter und Liberation Sans unter SIL Open Font License 1.1, DejaVu unter der Bitstream-Vera-Lizenz,
Bitstream Charter unter der Bitstream-Charter-Lizenz (Weitergabe erlaubt).
