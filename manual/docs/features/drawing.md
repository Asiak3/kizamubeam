---
sidebar_position: 1
title: Drawing and editing
description: Draw lines, curves, shapes and freehand strokes, select and transform objects, and edit nodes.
---

# Drawing and editing

Everything you draw in KizamuBeam is an editable vector shape. This page covers the drawing tools, selecting and transforming, and node editing. Combining and reshaping paths is described in [Paths and shapes](paths.md), exact placement in [Snapping, guides and measuring](precision.md).

## Drawing tools

The drawing tools are on the tools toolbar on the left and in the **Tools** menu.

| Tool | Shortcut | How to use it |
|---|---|---|
| **Lines and curves** | Ctrl+L | Click to set corners; click and drag to make a Bézier curve. Clicking the start point closes the shape; double-click, Enter or right-click finishes. |
| **Freehand / Pencil** | | Drag a stroke; it is fitted to smooth, editable curves when you release the mouse. Tool options set the tolerance and whether the stroke is closed. |
| **Rectangle** | Ctrl+R | Drag a rectangle. Shift draws a square, Ctrl draws from the centre. Corner radius in the numeric edits toolbar. |
| **Ellipse** | Ctrl+E | Drag an ellipse. Shift draws a circle, Ctrl draws from the centre. |
| **Polygon** | | Drag from the centre. Number of corners and **Star** in the numeric edits toolbar. |
| **Text** | Ctrl+T | See [Text and codes](text.md). |

Rectangles, ellipses, polygons and text stay editable as such: the corner radius, the number of corners or the text can be changed later. **Convert to Path** (Ctrl+Shift+C) turns them into ordinary paths.

## Selecting

- **Click** selects an object, **Shift+click** adds or removes one.
- **Marquee to the right** selects objects that lie completely inside, **marquee to the left** also those it only crosses.
- **Lasso selection** (**Tools → Path**): draw around objects to select those you enclose completely. Shift adds, Ctrl toggles.
- **Ctrl+A** selects everything on the current page; **Esc** clears the selection.
- A right-click opens a context menu with the commands that fit what is under the pointer: shapes, images, nodes or empty canvas.

When many objects lie on top of each other, **Tools → Isolate selection** helps: only the selected objects can be clicked and snapped to, everything else stays visible but out of reach. A badge at the top shows that isolation is active. Isolation does not affect the job; everything is still lasered. Leave it with **Leave isolation** or Esc.

## Moving, scaling and rotating

- Drag a selection to move it. Arrow keys move it by 1 mm (Shift 10 mm, Alt 0.1 mm).
- Drag a handle to scale. Shift switches between proportional and free scaling, Ctrl scales from the centre.
- **Click the selection a second time** (or drag just outside a corner) to rotate. The pivot can be moved. Shift snaps to 15°, Ctrl to 5°, Esc cancels.
- `.` and `,` rotate by 90°. **Ctrl+Shift+H** and **Ctrl+Shift+V** mirror.

### Exact values

The **numeric edits toolbar** at the top shows position, size and rotation of the selection. A 9-point anchor sets which point the values refer to. The fields accept formulas and units, for example `100/3`, `2in` or `25.4*3`, and project parameters such as `{Width}/2` (see [Templates and library](templates-library.md)).

## Grouping, aligning and arranging

- **Ctrl+G** groups, **Ctrl+U** ungroups.
- With several objects selected, **L R T B** align left, right, top and bottom, **C** and **E** align centres. The alignment button group in the main toolbar also distributes objects evenly.
- **Arrange → Stacking order** brings objects to the front or sends them to the back.
- Arrays, nesting and pattern fills are described in [Arranging and repeating](arranging.md).

## Editing nodes

Choose **Edit nodes** (Ctrl+`) to change the shape of paths. With several paths or shapes selected, the nodes of all of them can be edited together.

| Action | How |
|---|---|
| Select nodes | Click, Shift+click, marquee (or **Node lasso**) or Ctrl+A |
| Move nodes | Drag them, or nudge with the arrow keys |
| Delete node | D or Delete |
| Insert node | I, or double-click a segment |
| Segment as line / curve | L / C |
| Node as corner / smooth | E / S |
| Break the path at the node | B |
| Trim the edge back to the intersections | T |

Deleting a segment splits the path there. Every operation is one undo step.

## Undo and history

**Ctrl+Z** undoes, **Ctrl+Y** (or Ctrl+Shift+Z) redoes. The **History** window (next to Objects) lists the last 200 changes by name, such as “Move” or “Offset”; click a row to jump several steps back or forward at once.
