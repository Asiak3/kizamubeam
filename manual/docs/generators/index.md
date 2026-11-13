---
title: Generators
description: Generators create finished parts from a few dimensions, such as boxes, gears and slot-together models, and keep them editable.
---

# Generators

Generators create finished parts from a few dimensions instead of drawing them by hand. They are all in the **Toolbox** (**Tools → Toolbox …**, **Window → Toolbox** or the tile button in the tools toolbar), sorted into groups and searchable.

| Page | Generators |
|---|---|
| [Gears and racks](gears.md) | Gear, gear pair, rack |
| [Pulleys and cams](pulleys-cams.md) | Timing pulley, disc cam |
| [Finger-jointed boxes](boxes.md) | Finger Joint Box, Finger Joint Box with Dividers |
| [Drawers, inserts and shelves](drawers-shelves.md) | Drawer, divider insert, slot-together shelf |
| [Layered and rib models](models-3d.md) | Layered model and rib model from an STL or OBJ file |
| [Disc sphere](disc-sphere.md) | A sphere or lamp shade made of interlocking discs |
| [Multi-layer work](multilayer.md) | Your own shapes stacked into a layered relief |

Joints between your own shapes, the lid hinge, living hinges and slots are tools rather than generators: see [Joints, hinges and 3D view](../features/construction-3d.md). Jigs are described under [Print and Cut and jigs](../features/print-and-cut.md#jigs), dimensioned sketches under [Snapping, guides and measuring](../features/precision.md#sketches-with-dimensions).

## Working with generators

### Create and Add

Every generator dialog shows a live preview and checks the values as you type; problems appear in red or orange below the fields. Rarely needed settings are under **Advanced**.

- **Create** makes the part and closes the dialog.
- **Add** makes the part and keeps the dialog open, so you can set up the next one with other values. When you edit an existing part, Add creates a new one and leaves the edited part unchanged.

New parts go to the first free spot on the page, starting at the bottom left, 2 mm apart and 3 mm from the edge. Every object on the page is avoided, and an assembly (such as a box) keeps its layout. When the page is full, the part goes onto a new page. A part larger than the work area asks first: **Create anyway** in the centre, go back, or cancel. Each Create or Add is one undo step.

### Editing a part later

Generators create **parametric parts**: they keep their parameters in the project. **Double-click** a part to reopen its dialog. The outline is recalculated, and position and rotation stay. For an assembly such as a box, a double-click on any panel edits the whole box; parts that are no longer needed disappear and new ones (such as a lid) are added.

Some changes would break the parameters: scaling, node editing, or a Boolean operation without "Keep originals". KizamuBeam then asks whether to convert the part to ordinary paths or to edit its parameters instead. **Convert to Path** does the conversion on purpose.

### Formulas and parameters

Every numeric field accepts a [project parameter](../features/templates-library.md#parameters) or a formula, for example `{Thickness}` or `{Width} - 2 * {Thickness}`. Choice and yes/no fields get a parameter with the ƒ button. That way a box in a template follows the values filled in, and changing the material thickness in one place updates every part.

### Kerf and clearance

Most generators have a **Kerf** field: the width of the laser cut. Outlines are offset outward by half of it and holes and slots get smaller, so parts come out at their nominal size. A kerf offset on the layer is applied on top, so set the kerf in one place only.

Slot-together parts also have a **Fit clearance**: how much play each joint gets (negative values give a press fit). Once the material of the layer is [calibrated](../features/materials-tests.md#calibrate-fit), new parts take thickness, kerf and clearance from the calibration, and existing parts offer a button to apply it.

### Checking the result

The [3D view](../features/construction-3d.md#3d-view) shows assemblies put together and marks collisions in red. The [design check](../features/construction-3d.md#check-the-design-before-cutting) tests the fit of every joint and whether the parts can be assembled in some order.
