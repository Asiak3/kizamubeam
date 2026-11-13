---
sidebar_position: 2
title: File formats
description: Which files KizamuBeam opens, imports and exports.
---

# File formats

## Import

**File → Import** (Ctrl+I), drag and drop from the file manager, or paste with Ctrl+V.

| Format | Notes |
|---|---|
| Images: PNG, JPG, BMP, GIF, WebP, TIFF | Size from the file’s resolution (254 DPI if none is given). Multi-page TIFF: first page. |
| SVG | Paths, basic shapes, transforms, embedded images. Texts are skipped; convert them to paths before saving the SVG. |
| DXF | Lines, polylines with arcs, circles, arcs, ellipses, splines and blocks. Units from the file. |
| PDF | Paths stay curves, colours map to layers, embedded images and text (as outlines). Every page goes onto its own project page. |
| Adobe Illustrator (`.ai`) | Files from Illustrator 9 onwards (they contain a PDF version); imported like PDF. |
| LightBurn projects (`.lbrn2`) | Shapes, images, groups and layer settings. **File → Open** makes a new project, **Import** inserts into the current one. |
| 3D models: STL, OBJ | Turned into a layered or rib model of flat parts. |

## Export

**File → Export**, also as toolbar buttons.

| Format | Notes |
|---|---|
| SVG | Current page, with images |
| DXF | Current page, one DXF layer per KizamuBeam layer, curves as exact splines. Images cannot go into DXF. |
| PDF | All pages at bed size 1:1, one PDF layer per KizamuBeam layer, images embedded |
| Adobe Illustrator (`.ai`) | Same PDF-compatible file; opens in Illustrator, Inkscape and Affinity |
| G-code (`.gcode`, `.nc`) | **Laser → Save GCode …** for the selected device |
| PNG | **Save Processed Bitmap**: an image exactly as it would be lasered |

Texts are exported as outlines.

## KizamuBeam’s own files

| Extension | Content |
|---|---|
| `.kzb` | Project (older `.lwk` files still open) |
| `.kzt` | Template with parameters |
| `.kzm` | Material library (older `.lwm` files can still be imported; LightBurn `.clb` libraries too) |
| `.kza` | Library item (motif, image, design element) |
| `.kzp` | Extension pack, see [Extensions](../extensions/index.md) |
| `.kzb-camera` | Camera calibration |
