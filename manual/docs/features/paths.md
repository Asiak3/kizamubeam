---
sidebar_position: 2
title: Paths and shapes
description: Combine shapes with Boolean operations, offset, warp, round corners, join, trim and simplify paths.
---

# Paths and shapes

KizamuBeam’s shape tools always return clean Bézier curves: corners and straight segments are kept, and rounded parts are fitted with at most 0.02 mm deviation. Results stay editable like anything you draw.

## Boolean operations

Select two or more shapes and choose one of the operations under **Tools → Boolean Operations** or in the button group of the main toolbar:

| Operation | Shortcut | Result |
|---|---|---|
| **Weld** (union) | Alt++ | Merges the shapes into one outline. On a single group or text, it merges its overlapping parts. |
| **Boolean Difference** | Alt+- | Cuts one shape out of the others. |
| **Boolean Intersection** | Alt+* | Keeps only the area where the shapes overlap. |

**Boolean Options** (in the button group or under **Tools → Boolean Operations**) set which shape is the base (first selected, backmost or frontmost) and whether the originals are kept. The same menu also has **Subtract front from back** and **Subtract back from front**.

Good to know:

- Shapes in a group count as one area, so overlaps inside a group do not turn into holes.
- Texts and groups are treated as outlines automatically.
- Open lines, such as living hinge cuts, are trimmed exactly at subtracted shapes.
- Images are left out.

## Offset

**Offset Shapes** (Alt+O) draws a new outline at a given distance, outward, inward or both, with round, sharp or beveled corners and a live preview. Open lines get a closed outline around them. Typical uses: a border around text, a backing plate, or an inlay pocket.

## Warp

**Tools → Warp …** bends the selection over its frame: arc, arc upper, arc lower, bulge, flag or vanishing-point perspective, from −100 to 100 %, optionally rotated by 90°. Shapes, text and images are warped together. Shapes and text become Bézier paths, images are recalculated at their original resolution.

## Path tools

Under **Tools → Path**:

- **Close path** closes open paths whose ends are at most 0.5 mm apart. **Close paths with tolerance …** goes up to 20 mm and shows how many shapes will be closed.
- **Auto-join selected shapes** (Alt+J) joins open paths whose ends meet (within 0.05 mm) into one path.
- **Break apart** (Alt+B) splits paths, shapes and texts into their individual lines and curves.
- **Trim shapes** (Ctrl+K): hover over a curve, the piece up to the next intersections turns red and is removed with a click. The remaining pieces are joined at the intersections, so two overlapping circles become one outline after two clicks. Ctrl+click does not join, Shift+click keeps the removed piece.
- **Set start point**: click a node to make the cut start there, or click an edge to insert a new start node. Shift+click reverses the direction. While the tool is active, all start points, directions, lead-ins and lead-outs are shown on the workspace exactly as the job will cut them.
- **Reverse direction** flips the cut direction.
- **Mark centers** adds a small cross at the centre of every circle and arc, for centre punching or drilling.

## More path tools

- **Tools → Extract outer contour and islands …** derives the outer silhouette of the selected objects, optionally with chosen inner areas, for example as a backing plate.
- **Tools → Path → Separate path islands …** splits a path made of several separate pieces into independent objects; each piece keeps its own holes.
- **Tools → Path → Edit freehand path …** continues an open path at one of its ends or redraws a section between two nodes by hand.
- **Tools → Local contour offset …** moves only part of a contour outward or inward.

## Rounding and chamfering corners

**Tools → Path → Round or chamfer corners …** rounds corners of any vector shape with an exact radius, rounds them inward or chamfers them. In the node editor it works on the selected nodes, otherwise on all corners of the selected shapes. If an edge is too short, the radius is reduced.

## Simplifying paths

**Tools → Simplify / smooth paths …** refits the selected paths with fewer nodes, as curves or as straight lines, within a tolerance in mm. Sharp corners can be kept. An orange preview shows the result before you apply it. This is useful for traced images and imported files with many nodes.
