---
sidebar_position: 1
title: A box with an engraved lid
description: Make a closed finger-jointed box from plywood, with a name engraved on the lid, that fits together without glue.
---

# A box with an engraved lid

In this tutorial you make a closed box of 3 mm plywood, about 100 × 80 × 50 mm, with a name engraved on the lid. The fingers should hold the box together without glue.

**You need:** a sheet of 3 mm plywood (a scrap for the test, a piece of about 300 × 200 mm for the box) and a caliper or ruler.

## 1. Calibrate the fit (once per material)

A box only holds when kerf and clearance suit your laser and your material. Measure this once and KizamuBeam remembers it.

1. Measure the plywood with a caliper in several places and note the average, for example 2.9 mm.
2. Choose the material of the cut layer in the layers window, or add it in the [material library](../features/materials-tests.md#material-library).
3. Choose **Laser → Tests and Calibration → Calibrate Fit …**. The test parts appear on a new page.
4. Cut the test parts on a scrap piece with your cutting settings.
5. Measure the square, find the tab and the slot that fit best, and enter the values. KizamuBeam stores kerf and clearance with the material.

Details are in [Calibrate fit](../features/materials-tests.md#calibrate-fit). If you skip this step, start with a kerf of 0.15 mm and a fit clearance of 0 and adjust after the first box.

## 2. Create the box

1. Open the **Toolbox** and choose **Boxes and Furniture → Finger Joint Box**.
2. Set **Dimensions** to **Outside dimensions** and enter width `100`, depth `80` and height `50`.
3. Enter the **Material thickness** you measured.
4. Set **Up** to **Closed (lid with fingers)**.
5. With a calibrated material, the dialog already uses its kerf and clearance. Otherwise enter them yourself.
6. Click **Create**.

The six panels appear on the page in a compact layout. They are one parametric part: double-click any panel to change the size later.

## 3. Engrave the name on the lid

1. Find the lid: it is the panel with the same width and depth as the base.
2. Choose the text tool (Ctrl+T), click on the lid and type a name. Pick a font and a height of about 12 mm.
3. Put the text on its own layer: click another colour in the palette, then set that layer to **Fill** in the layers window.
4. Select the text and the lid and centre them on each other with **C** and **E**.
5. Group the text with the lid (Ctrl+G), so it moves along when the box is rearranged.

## 4. Check the box in 3D

Open **Window → 3D View**. The box is shown assembled, with the name on the lid (tick **Engravings**). Drag the **Explode** slider to see how the panels fit together. Red areas mean that two parts collide; check the thickness and clearance if you see any.

**Laser → Check Design** also checks every joint against the calibration and finds open outlines or double lines.

## 5. Laser it

1. Set speed and power on both layers. Use the values from your [material test](../features/materials-tests.md#material-test) or the material library.
2. Make sure the engraving layer comes before the cut layer in the layer list, so the panels are engraved before they are cut free.
3. Check the job with the preview (Alt+P), place the plywood, frame and start.

## 6. Assemble

Push the panels together by hand: first the sides onto the base, then the lid. If the fit is too tight, tap the joints with a piece of wood instead of forcing them. For the next box:

- **Too tight:** raise the fit clearance by 0.05 mm.
- **Too loose:** lower it by 0.05 mm, or use a few drops of wood glue.

## Going further

- Make the lid openable with a [lid hinge](../features/construction-3d.md#lid-hinge).
- Add dividers with the **Finger Joint Box with Dividers** or a [divider insert](../generators/drawers-shelves.md).
- Save the project as a template with a parameter for the name: see [Name tags from a list](name-tags-from-a-list.md).
