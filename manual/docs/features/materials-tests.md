---
sidebar_position: 11
title: Materials and tests
description: Store proven settings in the material library and find them with material tests, focus tests and the fit calibration.
---

# Materials and tests

Good results depend on the right speed, power and focus for each material. KizamuBeam helps you find these values with test patterns and keeps them in a material library, so you only have to find them once.

## Material library

The **Material** window stores cut settings per material and thickness, optionally with the image settings too. To use an entry, select a layer and apply the entry to it; the layer takes over all its settings.

- **Save**: set up a layer the way you like it and save it as a new entry (material, thickness, title).
- **Exchange**: export and import entries as `.kzm` files. Older `.lwm` files still import, and LightBurn libraries (`.clb`) are imported as far as their fields have an equivalent.
- **Extensions** can add material entries too (see [Templates, library and extensions](templates-library.md#extensions)).

Material entries also carry the [3D look](construction-3d.md#material-look) and the results of a [fit calibration](#calibrate-fit).

## Material test

**Laser → Tests and Calibration → Material Test …** (or the **Toolbox → Laser and Calibration**) creates a grid of test cells with two stepped values, for example speed in the rows and power in the columns, with labels. Each cell gets its own test layer.

The test does not change your document: send it straight to the laser with Preview, Frame, Start or Save G-code in the dialog. The cells run in order of increasing energy, so a test you stop early has done the gentle cells.

Typical uses:

- **Engraving**: find the speed and power that give the darkness you want without burning.
- **Cutting**: find the fastest speed that still cuts through (set passes in the dialog).
- **Scoring**: find a line that is visible but does not go deep.

## Evaluate a material test from a photo

**Laser → Tests and Calibration → Evaluate Material Test …** (or **Evaluate Photo …** in the test dialog) helps you read the result:

1. Take a picture with the connected camera, or open a photo (from a phone, for example).
2. Click the four corners of the cell grid. With a calibrated camera and absolute start, the grid is placed automatically.
3. Click the best cell in the photo, and apply its values to the active layer or save them to the material library.

KizamuBeam measures how dark each cell is against the bare material in the gaps, and for engravings suggests the cell that is almost as dark as the darkest one with the least energy. Whether a cell burned too much or cut through is still for you to judge.

## Focus test

**Laser → Tests and Calibration → Focus Test …** helps you find the right distance between laser head and material.

- **Ramp** works with every laser. Tilt the material on a shim, laser one long line with height marks underneath, then click the sharpest spot in the dialog. KizamuBeam tells you how far the focus is off.
- **Z series** needs a motorized Z axis. It lasers a row of short lines, each at a different Z offset. Click the sharpest one to enter its offset on the layer or move Z there directly.

Like the material test, the focus test never touches your document.

## Calibrate fit

Slot-together parts only fit when kerf and clearance are right. **Laser → Tests and Calibration → Calibrate Fit …** (also in the Toolbox and in the Material window) creates test parts on a new page:

- a 20 × 20 mm square to measure the kerf,
- a slot comb with stepped slot widths,
- a hole plate with a tab comb with stepped clearance.

The numbers are engraved on a separate layer. After lasering, measure the square and enter it, together with the number of the best-fitting tab and slot. KizamuBeam computes the kerf, the clearance per side and the slot allowance and stores them with the material in the library. A kerf offset on the layer is taken into account.

From then on, new boxes, drawers, inserts and shelves take thickness, kerf and clearance from the calibration of the layer's material, and the Joint tool proposes matching values. Existing parts get a button to apply the calibrated values, and the [design check](construction-3d.md#check-the-design-before-cutting) compares joints against the calibration.

## Project notes

**Window → Notes** keeps notes on the material (type, thickness, source), the setup (focus, bed, origin, how the piece is held) and the processing (order, passes, finishing, what to change next time). The notes are saved in the project file and in templates, so the next run starts with what you learned.
