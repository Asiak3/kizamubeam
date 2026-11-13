---
sidebar_position: 3
title: Snapping, guides and measuring
description: Snap to nodes and grid, use guides, measure, apply relations and draw dimensioned sketches.
---

# Snapping, guides and measuring

## Snapping

**Snap** in the status bar switches snapping on and off. Objects and the pointer snap to nodes, midpoints, centres, intersections, lines and quadrant points of circles. **Grid** in the status bar snaps to the grid.

- **Ctrl** while dragging switches snapping off (or on) for the moment.
- **Alt** while dragging snaps more strongly and shows alignment guides on other objects.

Circles and arcs are also recognised inside paths, for example holes in a plate or imported DXF circles, so their true centre snaps. **View → Show centers** shows centre crosses always, for the selection only, or not at all.

## Grid

**View → Grid** shows or hides the grid. Under **Grid Settings …** you set the spacing (e.g. 25.4 for inches), subdivisions, every nth line bold, colour and opacity, and optionally use the finest spacing as the snap grid.

## Guides

Drag a guide out of the top ruler (horizontal) or the left ruler (vertical). Guides lie on their own **Guides** layer: they are never lasered or exported, and Ctrl+A, the palette and shape operations leave them alone. Drag a guide to move it, or back into the ruler to delete it. The Guides layer can be hidden and locked in the Objects window. Guides apply to all pages.

## Measuring

**Tools → Measure** (or the ruler button): click a start and an end point, with snapping. KizamuBeam shows length, Δx, Δy and angle; over a circle, diameter and radius. Esc clears the measurement.

## Relations

**Arrange → Relations** (or the relations button group on the tools toolbar) moves or turns one object so that it relates to another. Click the reference first (it stays), then the element of the object that should adapt.

| Relation | What it does |
|---|---|
| **Concentric** | Two circles, ellipses or polygons share a centre (also holes inside paths). |
| **Equal size** | Same radius for two circles, same length for two edges. |
| **Parallel** / **Perpendicular** | The second object turns by the smallest angle. |
| **Horizontal** / **Vertical** | Turns one edge level or upright. |
| **Tangent** | The second object moves until it touches. |
| **Distance** | Asks for a distance between edges, points or circles. |

Relations are applied once, like a command; each is one undo step.

## Sketches with dimensions

For parts that must keep exact dimensions while you change them, use **Toolbox → Sketches with relations → New sketch** (or **Convert to sketch**). In a sketch, lines, rectangles, circles and arcs keep their relations and dimensions permanently, like in a CAD program.

- Relations from the bar at the top or by key: coincident (O), horizontal (H), vertical (V), parallel (P), perpendicular (N), equal (E), tangent (T), concentric (X), midpoint (M), symmetric (Y), fixed (F).
- **Dimension** (D): a line gets a length, two lines an angle, a circle a diameter, an arc a radius, two points a distance. Double-click a dimension to change it. Dimensions can be formulas with project parameters, such as `Width / 2`.
- Colours: blue = still free, dark = fully defined, red = conflict.
- Construction geometry (G) is drawn dashed and never lasered.

Double-click reopens a sketch, Enter or **Done** closes it, **Cancel** discards all changes since opening.
