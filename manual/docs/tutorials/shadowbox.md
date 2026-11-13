---
sidebar_position: 4
title: A layered shadowbox
description: Build a landscape shadowbox from several cut layers with motifs from the library, check the depth in 3D and glue it together.
---

# A layered shadowbox

A shadowbox is a picture made of several stacked layers, each with a cut-out, so the scene gets depth. In this tutorial you build a small landscape with five layers: a back panel, sky with a moon, mountains, trees and a front frame.

**You need:** five pieces of 3 mm plywood or thick card, about 150 × 150 mm each, and wood glue. Coloured card or painted layers look especially good.

## 1. Plan the layers

Every layer has the same outer frame, so the stack stays flush. From back to front:

| Layer | Content |
|---|---|
| 1 | Back panel, closed |
| 2 | Sky: a frame with a round moon cut out |
| 3 | Mountains |
| 4 | Trees |
| 5 | Front frame |

## 2. Draw the frame

1. Draw a square of 150 × 150 mm (rectangle tool, Ctrl+R, then enter the size in the numeric toolbar).
2. Draw a second square of 130 × 130 mm and centre it on the first (**C** and **E**).
3. Copy the outer square first (Ctrl+C, Ctrl+V) and move the copy aside: it becomes the back panel.
4. Select both squares of the frame and choose **Boolean Difference** (**Tools → Boolean Operations**). You now have a frame.

## 3. Build each layer

Copy the frame for the layers 2 to 5 (Ctrl+C, Ctrl+V) and place the copies side by side.

1. **Sky**: draw a square that fills the opening and overlaps the frame, and a circle for the moon on it. Subtract the circle with **Boolean Difference**, then **Weld** the result to the frame.
2. **Mountains**: draw a mountain line with the **Lines and curves** tool (Ctrl+L) across the opening, closing it along the bottom of the frame, and **Weld** it to the frame.
3. **Trees**: open **Window → Library**, search for "tree" and drag a few trees onto the workspace. Let them stand on a hill drawn along the bottom and **Weld** everything to the frame.
4. **Front frame**: the frame alone, or with a few branches from the library hanging into the opening.

Keep every layer as one closed outline: check that parts that should hold together really touch the frame. Loose islands would fall out.

## 4. Stack them

1. Select all five layers.
2. Choose **Toolbox → 3D Slot-Together Models → Multi-layer work**.
3. Order the layers from bottom to top: back panel first, front frame last. Give each a name and a thickness of 3 mm.
4. Click **Create**.

Open **Window → 3D View**. The layers are stacked flush, and you can turn the view to judge the depth. If a layer covers too much of the one behind it, change the shapes and look again. To change the order or thickness later, select the layers and start **Multi-layer work** again. More in [Multi-layer work](../generators/multilayer.md).

## 5. Cut and glue

1. Put all outlines on a cut layer and run **Laser → Check Design**: it finds open outlines and parts that are too small.
2. Cut the layers. Small details such as tree branches need a slower speed or an extra pass to cut through cleanly.
3. Paint or colour the layers if you like, before gluing.
4. Glue the stack from back to front, pressing the outer frames together so they stay flush. Clamp or weight it while the glue dries.

## Ideas

- An LED strip between the back panel and the sky layer makes a night light.
- Engrave stars on the back panel with a fill layer before cutting.
- For a relief from a 3D model instead of your own drawing, use the [layered model](../generators/models-3d.md).
