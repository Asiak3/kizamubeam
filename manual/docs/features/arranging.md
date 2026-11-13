---
sidebar_position: 9
title: Arranging and repeating
description: Grid and circular arrays, nesting to save material, and seamless pattern fills.
---

# Arranging and repeating

## Aligning and distributing

With several objects selected, the alignment button group in the main toolbar (and **Arrange → Align and distribute**) aligns edges or centres and distributes objects evenly. Keyboard: **L R T B** for left, right, top, bottom, **C** and **E** for the centres.

## Arrays

**Tools → Array** makes many copies at once, with a live preview. Bézier curves are copied exactly.

- **Grid Array …** (Ctrl+Shift+A): columns and rows, with the gap between copies or the distance between their centres, direction, an offset for every other row or column (for a brick layout) and optional mirroring of every other row or column.
- **Circular Array …**: copies in a circle around a centre point.

## Nesting

**Arrange → Nest …** (also on the tools toolbar and in the Toolbox) arranges the selected parts by their real outlines, not just their bounding boxes, to save material.

**Where:**

- the work area,
- a material size (width × height at a position), or
- a selected shape as the sheet, for example the outline of a scrap piece.

**Settings:**

- **Spacing** between parts and to the edge (allow for the kerf).
- **Rotation**: none, 180° only, or in 90°, 45°, 15° or 5° steps.
- The corner to start from.
- **Precision**: fast, normal or thorough. Normal and thorough try several orders and keep the best.

Small parts can go into holes of larger ones, and other objects on the page are avoided. What doesn’t fit goes onto new pages. Things that belong together move together: holes drawn as separate shapes, engravings and text on a part, generator assemblies. Nesting is one undo step.

## Pattern fill

**Toolbox → Copy and Arrange → Pattern fill** fills a closed shape with a seamless pattern made of real vectors, for decorating surfaces.

1. Select the target shape.
2. Pick a tile: one of 13 built-in patterns (honeycomb, scales, waves, Truchet, rings, diamonds, herringbone, basket weave, stars, dots, circle grid, chevron, ogee), a pattern you saved, or your own objects (a rectangle around them sets the tile frame).
3. Choose how tiles repeat: grid, brick, half drop, mirrored, rotated by 90° (pinwheel) or hexagonal, with offset, spacing (negative = overlap), size, rotation and shift.

At the edge the pattern is clipped exactly, or only whole tiles are kept; a margin keeps the outline free, and text, images and codes on the shape are kept free automatically. Lines where tiles meet are cleaned up, so nothing is lasered twice. **Wrap edges** lets lines that leave the tile continue in the neighbouring one.

The result can be lines (to engrave, score or cut) or areas for fill layers. The pattern stays one object: double-click it to change any setting. **Save as pattern** stores tile and settings in the library.
