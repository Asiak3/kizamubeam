---
sidebar_position: 5
title: Layers and cut settings
description: How layers work, the modes Line and Fill, and every cut setting from passes to tabs, lead-ins and sub-layers.
---

# Layers and cut settings

## Colour is the layer

Every object belongs to a layer, and every layer has a colour from the palette at the bottom (00–29, plus the tool layers T1 and T2). Click a colour in the palette to put the selection on that layer.

The layer holds **all laser settings**. Objects, including images, never carry their own speed or power: to laser something differently, put it on another layer. That way a layer is one operation of the job, and the same settings apply to everything on it.

The **Cuts / Layers** window lists the layers that are in use, with mode, speed, power, air assist and output. Values can be edited right in the table; drag rows to change the order in which the layers are lasered.

## Modes

| Mode | What happens |
|---|---|
| **Line** | The laser follows the outlines: cutting and scoring. |
| **Fill** | Closed shapes are engraved line by line (or in rings with offset fill). Open lines are skipped. |

Images can sit on any layer. The table then shows “+ Image”, and the layer dialog gets an **Image** section with line interval and image settings. Each image keeps its own image mode (see [Images and tracing](images.md)); speed and power come from the layer.

## Tool layers T1 and T2

T1 and T2 are never lasered. Use them for construction lines, the outline of a workpiece, camera images to trace, or the path of a text on a path you do not want to cut.

## Output and visibility

- **Output** decides whether a layer is lasered at all. Hidden layers and objects are still lasered if their output is on; KizamuBeam warns you about that before the job.
- In the [Objects window](objects-pages.md) single objects can be set to **Don’t laser**: they stay visible (faded) but are not lasered, not written to G-code and not checked.

## Cut settings

Double-click a layer to open its **Cut Settings**. Which fields appear depends on the mode.

### Common to all modes

| Setting | Meaning |
|---|---|
| **Speed (mm/min)** | Feed rate while the laser is on. |
| **Max Power (%)** / **Min Power (%)** | The layer’s power. Min Power is used where power is lowered: in power ramps and for the lightest tones of grayscale images. |
| **Passes** | How often the layer is repeated. |
| **Air Assist** | Switches air assist (M8 or M7) on for this layer. |
| **Z offset (mm)** and **Deeper per pass (mm)** | Only with a motorized Z axis: move the focus relative to the start height, and go deeper with each pass. |
| **Material** | Links the layer to an entry of the material library; also used by the 3D view and the fit calibration. |

### Line

| Setting | Meaning |
|---|---|
| **Kerf Offset (mm)** | Moves the cut outward on outer contours and inward on holes, so parts keep their nominal size. Usually half the kerf width. |
| **Tabs** | Leaves small bridges uncut so parts do not fall out: count per shape or spacing, tab size, optionally skip inner shapes. |
| **Perforation** | Cuts a given length, then leaves a gap, for tear-off edges or fold lines. |
| **Lead-in / Lead-out** | A straight line at an angle or an arc into and out of the contour, always on the waste side, so the start point leaves no mark on the part. |
| **Overcut (mm)** | Continues past the start point to make sure the contour is closed. |
| **Power ramp** | Lowers the power toward corners (from a set change of direction) to avoid burn marks, optionally at the start and end of each cut too. |
| **Duplicate lines** | Removes lines that lie on top of each other before cutting, so nothing is cut twice. |

### Fill

| Setting | Meaning |
|---|---|
| **Line interval (mm)** or **Lines per inch** | Distance between the fill lines. |
| **Scan angle (°)** | Direction of the lines: 0° horizontal, 90° vertical. |
| **Crosshatch** | A second pass rotated by 90°. |
| **Bi-directional** | Lasers in both directions (faster). |
| **Overscan (%)** | Runs past the edges with the laser off, so the head is at full speed when it fires. Avoids darker edges. |
| **Fill style** | **Line by line**, or **Offset fill**: rings that follow the outline inward. |

**Defaults** resets the fields to the defaults of the selected mode.

## Sub-layers

**+ Sub-layer** adds further operations on the same shapes, each with its own mode, speed, power, passes and settings. A classic use is “fill, then cut the outline” on a single layer. Sub-layers run after the layer itself and can be switched off one by one.

## Appearance in 3D

**Appearance in 3D** sets how the layer’s parts look in the [3D view](construction-3d.md): 21 materials from plywood to slate, acrylic and anodized aluminium, each with an optional own colour.

## Material library

The **Material** window stores proven settings per material and thickness and applies them to a layer with one click. See [Materials and tests](materials-tests.md).
