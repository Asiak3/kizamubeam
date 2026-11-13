---
sidebar_position: 10
title: Joints, hinges and 3D view
description: Add finger joints, tenons, snap fits and hinges to any shape, adapt slots to the material, and check assemblies in the 3D view.
---

# Joints, hinges and 3D view

KizamuBeam can turn ordinary shapes into parts that slot or glue together. The [generators](../generators/index.md) build complete boxes, drawers and shelves; the tools on this page work on shapes you drew or imported yourself.

## The Joint tool

The **Joint** tool (the Joint button in the tools toolbar, or **Toolbox → Joints and Bending → Joints**) adds a joint between two straight edges:

1. Choose the tool. The status bar asks for the first edge.
2. Click the first straight edge. It gets the fingers or tenons.
3. Click the second straight edge. It gets the counterpart or the slots. If the second "edge" is a single drawn line, the line is replaced by slots, which is how you put a mortise in the middle of a panel.
4. Set the options in the dialog and confirm.

The result stays an ordinary, editable path. The joint remembers the material thickness, so [Resize slots](#resize-slots-to-the-material) can update it later.

| Type | Use |
|---|---|
| **Finger joint** | Box corners: interlocking fingers along both edges. |
| **Mortise and tenon** | Tenons on one panel, matching slots (mortises) in the other, also in the middle of a panel. |
| **Cross lap** | Both parts get slots of material thickness and are slid into each other; the depth is split between the two (for example 50 % each). Several slots make grid inserts and bottle dividers. |
| **Snap-fit joint** | Tabs with two flexible tongues and catch hooks; overhang, hook length and spring slot are adjustable. Holds without glue. |
| **Hook joint** | L-shaped hook tabs: insert, then slide. The slot is lengthened by the hook length. |
| **Wedged tenon** | Tenons pass through the other panel and have a wedge hole; the wedges are created too. |
| **T-slot** | A screw slot with a nut window between every two tenons, and a matching screw hole in the other panel. |
| **Lid hinge (with pin)** | See [Lid hinge](#lid-hinge) below. |

Common settings are the material thickness, the **kerf** (fingers and tenons are drawn wider, gaps and slots narrower, so the parts have their nominal size after cutting) and the **clearance** per side (negative values give a press fit). Once the material is [calibrated](materials-tests.md#calibrate-fit), the tool proposes kerf and clearance for the chosen type.

## Lid hinge

A lid hinge with a pin lets a box lid open beyond 90°. Start it from the **Toolbox → Boxes and Furniture → Lid hinge**, or choose **Lid hinge (with pin)** in the Joint tool:

1. Click the top edge of the back wall.
2. Click the back edge of the lid.

Both panels get slots, and knuckles with pin holes are created next to them. The outer knuckles belong to the box, the ones in between to the lid. Glue the knuckles into the slots and push a pin (wire, dowel, nail or filament) through all eyes. Number of knuckles, pin diameter, pin clearance and the wall around the hole are adjustable.

## Living hinges

**Toolbox → Joints and Bending → Living Hinge** fills a selected closed shape with a cut pattern, so the board bends in that area. Patterns: straight cuts, waves, diamonds, honeycomb, triangles, weave and spiral. The dialog shows a live preview and starts with values that suit the material thickness. The cuts are exact lines and Bézier curves.

Put the hinge area on the cut layer of the part. Plywood and MDF bend best across the grain of the top veneer; test on an offcut first.

## Resize slots to the material

Material is rarely exactly as thick as it says. **Toolbox → Joints and Bending → Resize slots** finds the slots that another plate slots into, also in imported SVG or DXF designs and in parts that are already plain paths:

- cut-outs (mortises, including a separate rectangle inside a plate),
- notches cut in from the edge (cross slots, half laps),

each with two parallel sides and deeper than wide. Finger joint gaps are left alone.

The dialog suggests the most common slot width (or the thickness of the layer's material), marks the slots it found in orange, and makes every slot wider or narrower by the difference to the new thickness, so the play stays the same. It searches the selection, or the whole page when nothing is selected. Boxes, drawers, inserts and shelves from the generators get the new thickness as a parameter instead. One undo step.

## Place slots and notches

**Tools → Place slots / notches …** puts rectangular slots or notches into a closed shape at an exact distance:

1. Select one closed vector object.
2. In the tool's preview, pick a reference corner (red) and a straight edge (orange).
3. Enter the distance along the edge and choose whether it is measured to the first outer edge, the centre or the second outer edge of the slot.

You can stage several cuts across different edges before you apply them. **Apply** is one undo step, **Cancel** discards everything, and a double-click on the part reopens the tool.

## 3D view

**Window → 3D View** (or the 3D button in the main toolbar) shows your parts assembled, as they will be after cutting:

- Boxes, drawers, inserts, shelves and gear pairs from the generators are put together automatically. The gears of a gear pair can turn.
- Parts joined with the Joint tool are assembled at the joined edges: one part lies flat, the others stand on it.
- Other closed shapes on cut layers lie flat with an adjustable thickness; nested shapes become holes.
- Layered, rib and disc models from [3D models](../generators/index.md) are shown assembled.

Turn the view with the mouse, or use the preset views (3D, top, front). The **Explode** slider pulls the parts apart. With nothing selected, the view shows the whole page; a selected part always brings its whole assembly.

**Collisions**: where two parts intersect (for example with a press fit or a slot that is too narrow), the area turns red, and the status line names the parts and the volume.

**Engravings**: with the checkbox **Engravings**, fills, engraved lines, text and processed images appear on the face that was up during lasering, with a slight depth.

### Material look

Each cut layer can get its own look in the layer dialog under **Appearance in 3D**: 21 presets such as poplar and birch plywood, beech, oak, walnut, bamboo, MDF, cardboard, cork, leather, slate, granite, clear, coloured and opaque acrylic, glass, anodized aluminium and stainless steel, each with an optional custom colour. Engravings look different per material: dark burn on wood, light grey on slate, frosted white on acrylic and glass. Layers without their own look take it from the name of their [material library](materials-tests.md#material-library) entry.

To show a flat piece without a cut (a slate coaster, for example), draw its outline on a layer with output off: it becomes the plate.

### Mockups for customers

Tick **Mockup** in the 3D window to hide the grid and the red collision marks and get soft shadows and a background of your choice (studio gradient, white, grey, dark or like the interface). **Save image …** stores the current view as a PNG at double resolution.

## Check the design before cutting

**Laser → Check Design** (or **Window → Design Check**) looks for problems on the current page and marks every finding on the workspace. Click a finding to select the objects and zoom to the spot; where possible, a button fixes it in one undo step.

It finds, among other things:

- lines that would be cut twice,
- outlines that are almost closed (gap up to 1 mm), and single lines that form an outline but are not joined,
- open lines on fill layers, which would be skipped,
- bridges between two cuts narrower than the minimum bridge (default 1 mm, kerf taken into account),
- cut-outs too small for the kerf,
- objects outside the work area,
- elements that an SVG or DXF import had to skip,
- the **fit** of slot-together joints from the generators and the Joint tool against material thickness and kerf (too tight, very tight, very loose).

The **assembly check** goes further for generator assemblies (box, drawer, insert, shelf, disc sphere, layered and rib model): every piece must be one connected part, and the check puts the parts together one by one. If no order works with straight moves, you get a warning.

The settings (minimum bridge, kerf width, gap size, layers that only engrave) are in the same window, together with the option to check before every job. If problems remain when a job starts, KizamuBeam lists them and asks whether to go on.
