---
sidebar_position: 15
title: Print and Cut and jigs
description: Cut out printed sheets precisely with registration marks, and laser batches of workpieces with a jig.
---

# Print and Cut and jigs

## Print and Cut

Print and Cut cuts out a printed sheet exactly along the print, for example stickers or cardboard figures. Start it from the **Toolbox → Laser and Calibration → Print and Cut**.

1. **Place marks**: put three registration marks around the design (or turn your own objects into marks). The marks are printed and exported, but never lasered.
2. **Print** the design at actual size (100 %, no "fit to page").
3. **Measure**: put the sheet in the laser. For each mark, move the head to its centre with a low-power laser dot and the jog buttons, or click it in the camera image.
4. **Align**: KizamuBeam moves and rotates the whole design onto the print. With three marks it also corrects printer scaling and skew. The remaining error is shown.
5. Frame and start as usual.

Two marks are enough to move and rotate; three also correct distortion from the printer.

## Jigs

A jig is a holding plate with cut-outs for a batch of identical workpieces, such as keychain blanks or coasters. Create it in the **Toolbox → Copy and Arrange → Jig**.

The slot shapes can come from:

- selected objects (any imported vector file, shapes or text),
- a traced photo or scan (enter the real width),
- pieces detected on the bed with the calibrated camera.

A jig can hold several kinds of workpieces, each with count and 0° or 90° rotation. The generator sets the clearance per side (kerf included), slot spacing, finger notches to take the pieces out, engraved slot numbers and three engraved registration marks. The plate fits the slots or has a fixed size. Double-click the jig later to change everything.

### Using a jig

1. Cut the jig and leave it in the laser (or put it back later).
2. Place your design on slot 1, for example a name.
3. Choose **Toolbox → Copy and Arrange → Place on jig slots** and enter the slots, such as `1-5, 8`. A copy goes into every chosen slot, at the same position within the slot.
4. Variable text counts up per slot (serial number or table row), and the jig itself is hidden so only the design is cut.

If you remove the jig and put it back, measure its engraved marks with Print and Cut: the jig and all copies are aligned together.

For workpieces lying anywhere on the bed, see [Place on workpieces](camera.md#place-on-workpieces).
