---
sidebar_position: 5
title: Layered and rib models
description: Turn an STL or OBJ file into stacked layers to glue, or into ribs that slot onto a spine.
---

# Layered and rib models

KizamuBeam turns a 3D model (STL, binary or text, or OBJ) into flat parts you can laser. There are two ways, both in **Toolbox → 3D slot-together models**. When you open or import an STL or OBJ file, or drop it onto the workspace, KizamuBeam asks which one you want.

The model is stored once in the project file, so the parts can be edited again later with a double-click.

## Layered model

The model is cut into stacked sheets that you glue back together: heads, figures, reliefs, terrain.

| Setting | Meaning |
|---|---|
| **Up in the model** | Which axis of the file points up. |
| **Layers** | Stacking direction: bottom to top, front to back or left to right. |
| **Size (longest side)** | Size of the finished model in mm. |
| **Material thickness** | Thickness of each sheet. |
| **Cross-section** | Where each sheet takes its outline: the middle of the layer; **outside** (nothing is missing, sand the steps off); or **inside** (no layer sticks out). |
| **Engrave numbers** | Each sheet gets its number, counted from the bottom, as a fine engraving on its own "Labels" layer. |
| **Smallest area (mm²)** | Smaller islands are left out, smaller holes filled (Advanced). |
| **Kerf** | Width of the laser cut. |

Several overlapping bodies in the file are merged per layer. Holes in the mesh up to 0.5 mm are bridged and reported. The check warns about empty layers, layers with several pieces and very many layers. The 3D view shows the stack.

**Tip:** with a wide model, choose the stacking direction (**Layers**) so the layers are as large as possible: fewer layers, less glueing.

## Rib model

Ribs stand across an axis and slot onto a spine with half slots, like wooden animal kits.

| Setting | Meaning |
|---|---|
| **Up in the model** | Which axis of the file points up. |
| **Axis** | Left–right, front–back or bottom–top: the direction the ribs follow. |
| **Spine stands** | Upright, facing front or sideways. |
| **Size (longest side)** | Size of the finished model. |
| **Material thickness** | Thickness of the board. |
| **Rib spacing (center to center)** | Distance between the ribs. |
| **Spine inset** | Keeps the spine from sticking out between the ribs (0 = full outline). |
| **Fit clearance** | Extra slot width; negative = press fit. |
| **Engrave numbers** | Each rib gets its number; the spine gets the number of the matching rib under each slot. |
| **Assembly plan as its own page** | Adds a page (not lasered) with a view, all part numbers, the assembly order and the parts list. |
| **Kerf** | Width of the laser cut. |

Where a rib and the spine cross, the shared line is split: the rib is slotted from below, the spine from above, so ribs are pushed onto the spine from above. Rib pieces that reach no spine are left out with a warning.

### Sections

Animals and figures need more than one spine: a body, legs, a head, a tail. In the drawing area of the dialog (front, side and top view with the model's silhouette) you draw **sections**, each with its own axis. An axis can be a polyline; ribs then stand across the curve.

Each section has a plane position (**Center** puts it in the middle of the material), its own rib spacing, a radius for the area it owns and an extension of its spine beyond the axis, so a leg plate reaches into the body and slots into the body ribs. The copy button mirrors a section, for example for the second leg. Drag points and lines to change them; in another view, dragging moves the plane.

**Suggest** finds sections automatically as a starting point: the mirror plane of the model becomes the body's spine, legs are traced upward from the floor, and thin ends such as a tail get curved sections of their own. Check and correct the suggestion before creating.

More options:

- **Denser at details, down to**: where the outline changes quickly (nose, ears), ribs move closer together, down to this spacing.
- **Split plates above** (Advanced): spine plates longer than this, for example longer than the bed, are split and joined with a dovetail.
- **Shift spine** (Advanced): moves the spine away from the centre.

The 3D view shows the assembled model and checks it for collisions; the [design check](../features/construction-3d.md#check-the-design-before-cutting) also tests whether the parts can be assembled in some order.

**Tip:** thin parts such as legs need a rib spacing that gives them at least two or three ribs, otherwise they have no hold. Thicker material makes the model sturdier but coarser.
