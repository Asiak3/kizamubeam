---
sidebar_position: 4
title: Text and codes
description: Write text with any font, put text on a path, use variable text and serial numbers, and create QR codes and barcodes.
---

# Text and codes

## Writing text

Choose the **Text** tool (Ctrl+T) and click on the workspace to start typing. Drag a box instead of clicking to get a text box with word wrap. Click an existing text to edit it.

The **text toolbar** below the numeric edits toolbar holds all text options: font, height, bold, italic, upper case, letter and line spacing, alignment, maximum width and height, weld, text on path and variable text.

| Option | What it does |
|---|---|
| **Weld** | Merges overlapping letters into one outline, for script fonts or tight letter spacing. |
| **Wrap** / **Max width** | Breaks lines at word boundaries at the box width; the box grows downward. Dragging the side handles reflows the text. |
| **Max. height** | Scales a block that gets too tall down evenly. |
| **Shrink** | Scales a text that is too wide down instead of condensing it. |

Text stays editable. **Convert to Path** (Ctrl+Shift+C) turns it into its real font outlines, for example before node editing.

## Fonts

All fonts installed on your computer can be used. **File → Fonts …** (or **More fonts …** at the end of the font list) opens the font manager:

- Search all Google Fonts with a live preview of your own sample text, filter by kind and sort by popularity or name.
- **Install** downloads the font into KizamuBeam, so it works offline and without installing it in the system. **Use** applies it to the selected text.
- Import your own TTF or OTF files the same way.
- Star a font to make it a favourite; favourites appear at the top of the font list.

When a project uses a font that is missing on this computer, KizamuBeam offers to download it from Google Fonts.

## Text on a path

Select a text and a shape, then choose **Tools → Text Functions → Apply Path to Text** (or **On Path** in the text toolbar). The text follows the line, curve, rectangle, ellipse or polygon. In the text toolbar you set the offset along the curve, the distance from the curve and which side the text is on.

Text and shape stay linked: if you edit or move the shape, the text follows. The shape is lasered too, unless it is on a tool layer (T1/T2) or hidden. **Tools → Text Functions → Remove Path from Text** separates them again.

## Variable text and serial numbers

Variable text fills in placeholders when the job is created, for serial numbers, dates or names from a list. Turn on **Variable** in the text toolbar and use these placeholders:

| Placeholder | Becomes |
|---|---|
| `%#` | Serial number; `%4#` with leading zeros (`0042`) |
| `%d.%m.%Y`, `%H:%M` … | Date and time |
| `%0`, `%1` … or `%{Header}` | Column of a CSV file (comma, semicolon or tab separated) |

The **Variable Text** window (**Tools → Text Functions → Variable Text …**) sets the current number, start, end, step and whether it advances automatically after every job or saved G-code file. The number is also the row of the CSV file. Each object can have its own offset, so one page can hold several consecutive numbers.

**Bake Variable Text** turns the current content into fixed text.

For a whole series of pages from a table, see [Templates and library](templates-library.md#series-from-a-table).

## QR codes

Click the QR button on the tools toolbar (or find it in the Toolbox). A QR code can contain:

- text or a web address,
- Wi-Fi access data,
- a contact card (vCard).

Choose the error correction (L, M, Q, H) and the size in mm. **Negative Image** lasers the background including the quiet zone, for dark materials. The modules are merged into closed outlines, so put the code on a **Fill** layer to engrave it. Double-click a QR code to edit it.

## Barcodes

**Toolbox → Text and Data → Barcode** creates Code 128, EAN-13, EAN-8, UPC-A, Code 39 and ITF barcodes, with check digits where the format uses them. Set the width and bar height, show the human-readable text below the bars, and reduce the bar width to make up for the beam width. **Negative Image** lasers the gaps instead of the bars. The dialog warns when bars get too narrow for the laser.

QR codes and barcodes accept variable text and project parameters too, for example a serial number as Code 128.
