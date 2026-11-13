---
sidebar_position: 3
title: Finger-jointed boxes
description: Open or closed boxes with finger joints, sized inside or outside, with kerf and fit clearance, and boxes with dividers.
---

# Finger-jointed boxes

Find both box generators in **Toolbox → Boxes and Furniture**. For a lid that opens on a pin, add a [lid hinge](../features/construction-3d.md#lid-hinge) afterwards.

## Finger Joint Box

| Field | Meaning |
|---|---|
| **Dimensions** | **Outside dimensions** or **Inside dimensions**: whether width, depth and height are measured outside or inside the walls. |
| **Width**, **Depth**, **Height** | Size of the box in mm. |
| **Material thickness** | Thickness of the board. Measure it; boards are rarely exactly as thick as sold. |
| **Up** | **Open**, or **Closed (lid with fingers)**. |
| **Finger width** | Minimum finger width. Every edge gets an odd number of equally wide fingers. |
| **Fit clearance** | Every finger gets this much narrower; negative = press fit. |
| **Kerf** | Width of the laser cut; outlines are offset outward by half of it. |

The front and back walls own the corners. The parts are separate objects in a compact arrangement: identical parts stay together. A double-click on any part edits the whole box, on every page. Parts still in their generated layout move apart when they grow; parts you arranged yourself stay where they are.

### Engraving on a panel

Put text or images on a panel and group them with it, or simply place them on top: in the 3D view, engravings show on the panel they lie on. The **labelled box** template (**File → New from template …**) is a ready example with a label on the front.

### Getting a good fit

1. Measure the material thickness with a caliper at several spots and enter the average.
2. Start with a fit clearance of 0 and the kerf of your laser (0.1 to 0.2 mm for a diode laser on plywood).
3. Cut the box. If it is too tight, increase the clearance in steps of 0.05 mm; if it is loose, decrease it.

The [fit calibration](../features/materials-tests.md#calibrate-fit) finds these values for a material in one test, and new boxes then take them automatically.

## Finger Joint Box with Dividers

An open or closed box with dividers that cross each other. This generator is **experimental**: check the parts in the 3D view and on an offcut before cutting the real material.

| Field | Meaning |
|---|---|
| **Width**, **Depth**, **Height**, **Material thickness**, **Up** | As for the box. |
| **Compartments across width** / **Compartments across depth** | Number of compartments in each direction. |
| **Width distribution** / **Depth distribution** | Clear compartment sizes as ratios or in mm, separated by colons. `1:2:1` makes the middle compartment twice as wide; `36mm:1` makes the first one 36 mm and the second takes the rest. `+ - * /` and parentheses work too. Empty = equal compartments. |
| **Divider drop below box top** | How much lower the dividers are than the walls. |
| **Kerf** | Width of the laser cut. |

**Finger width** and **Fit clearance** are under **Advanced**. Pieces and their holes share one layer.
