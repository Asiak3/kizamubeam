---
sidebar_position: 12
title: Running jobs and machine control
description: Start, frame and preview jobs, choose where a job starts, adjust power and speed while lasering, and configure devices.
---

# Running jobs and machine control

This page covers everything that happens after the design is done. How to connect a laser for the first time is described in [Connecting a laser](../getting-started/connect-laser.md).

The machine windows sit on the right by default: **Laser** (job, status, devices), **Move** (jogging and origin) and **Console**.

## Preview

**Laser → Preview …** (Alt+P) simulates the job before anything moves:

- playback with a time slider, travel moves, and shading by power,
- a time estimate that takes acceleration and corners into account,
- the same order as the real job.

**Start Here** lasers the job from the position of the time slider, for example after an abort. The head moves there with the laser off and continues with the power, speed and air assist of that layer.

## Frame

**Frame** traces the rectangle around the job, **Contour Frame** follows its outline. Both can run with a low-power laser so you can see the frame on the material. Use framing to check that the job fits on the workpiece before you start.

## Start, pause and stop

**Start** sends the job. During the job, the Laser window shows progress, elapsed and remaining time.

- **Pause** holds the machine; **Resume** continues.
- **Stop** stops the job and resets the controller. The position is kept.
- **Cut Selected Graphics** lasers only the selected objects.

Before every job and every frame, KizamuBeam checks that all moves, including overscan, stay inside the work area of the machine. If the controller has not reported its origin yet (or never does, as with Marlin), a warning shows the extent of the job and must be confirmed.

## Where the job starts

The **Start From** setting in the Laser window decides where the job lands:

| Start From | Meaning |
|---|---|
| **Absolute Coords** | The job is placed exactly where it is on the workspace. The workspace is the machine bed. Needs homing. |
| **User Origin** | The job starts at an origin you set with the Move window. |
| **Current Position** | The job starts where the head is now. |

With User Origin and Current Position, the **job origin** (nine points: corners, edge centres, centre) says which point of the job sits at that position.

## Adjust while lasering

**Adjust** in the Laser window changes power and speed in steps of 1 and 10 % (from 10 to 200 %) and rapid moves at 25, 50 or 100 %, while the job runs. Air assist can be switched on and off at once, also during a job. This works with GRBL, grblHAL and FluidNC.

## Cut order

The Laser window has three options for the order of the cuts. Layers are always lasered in the order of the layer table.

| Option | Effect |
|---|---|
| **Inner shapes first** | Holes and inner contours are cut before their outer contour, so parts do not drop before their holes are cut. |
| **Reduce travel moves** | The nearest shape is cut next. When off, the stacking order from the Objects window is used (manual order). |
| **Keep groups together** | Shapes of the same object or group are preferably cut one after another. |

To choose where a single cut starts and in which direction, use the start point tool (see [Paths and shapes](paths.md)).

## Move window

The **Move** window jogs the head in steps, sets and clears the user origin, unlocks the machine after an alarm, homes it and moves the head:

- **Move Laser to Selection** moves the head to the selected objects.
- **Move Laser to Click**: while this button is active, every click on the workspace moves the head there with the laser off. Esc ends the mode.

## Console

The **Console** shows the messages of the controller and lets you send commands, with a history. Alarms and active inputs (limit switches, door, probe) are explained in plain language.

## Saving G-code

**Laser → Save GCode …** writes the job to a file, for example to run it from an SD card or from another program.

## Devices and device settings

Each laser is a **device** with its own connection, work area and settings. Pick the device at the top of the Laser window, or manage them under **Laser → Device → Devices …**. New devices can start from templates for common lasers.

**Laser → Device → Device Settings …** holds, among others:

- work area, S value for 100 % power, baud rate, network address,
- rapid speed and acceleration (**Read from Machine** fetches them from FluidNC or GRBL),
- receive buffer size,
- limit switches (with "None", KizamuBeam never homes by itself and asks before homing),
- motorized Z axis (for Z offsets per pass and the focus test),
- air assist command (M8 or M7),
- **G-code scripts**: commands to run before and after every job,
- **red-dot pointer**: the offset between beam and pointer, so framing and click moves can aim with the red dot,
- **FluidNC** extras (see below).

## FluidNC extras

With a FluidNC controller, **Laser → FluidNC** offers:

- **Run job from the SD card or flash**: upload the job first and run it there, so a Wi-Fi dropout does not stop it. Pause and stop work as usual.
- **Files on the controller**: list, upload, run and delete files.
- **Configuration …**: read, search and change the config.yaml, try values out or save them, and restart. Every save keeps a backup of the previous state (the last ten per device), which you can restore.
- **Outputs**: free outputs (for example a fume extractor) can be switched in the Laser window and turned on automatically during every job.

## Controllers

KizamuBeam works with FluidNC, GRBL 1.1, grblHAL, Marlin and Smoothieware. Buttons for homing, jogging, origin and console adapt to the controller. See [Machine compatibility](../reference/machine-compatibility.md) for details and tested lasers.

## Rotary and remote lasers

- Engraving cylinders: see [Rotary](rotary.md).
- Running a laser that is connected to another computer: see [Remote control](remote-control.md).
- Trying everything without a laser: see [Virtual Machine](virtual-machine.md).
