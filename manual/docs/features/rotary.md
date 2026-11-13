---
sidebar_position: 13
title: Rotary
description: Engrave cups, glasses and other round objects with a roller or chuck rotary, including tapered objects.
---

# Rotary

A rotary turns a round object under the laser, so you can engrave cups, glasses, bottles or rolling pins. KizamuBeam converts the Y direction of your design into rotation of the object.

## Setting up

Open **Laser → Device → Rotary Setup …** (or **Rotary …** in the Laser window). The settings are stored per device:

| Setting | Meaning |
|---|---|
| **Enable rotary** | Switches rotary mode on for this device. |
| **Rollers / Chuck** | Rollers: the object rests on driven rollers. Chuck: the object is clamped and turned directly. |
| **Axis** | Y (rotary connected instead of the Y motor), or a separate A, B, C or Z axis. |
| **Travel per rotation** | How far the axis moves (in mm or degrees, usually 360°) for one full turn of the roller or chuck. |
| **Roller diameter** | Diameter of the driven roller (rollers only). |
| **Object diameter** | Measured at the widest point of the engraving. You can enter the circumference instead, for example measured with a tape. |
| **Reverse direction** | Flips the rotation if the design comes out mirrored. |

**Test rotation** turns the object exactly once with the values entered. If it turns too far or not far enough, change the travel per rotation in the same ratio.

## How it works

When the rotary is on:

- the design's Y direction becomes rotation, and the speed is adjusted so the speed on the surface is right,
- this applies to jobs, images, frame, Move and Start Here,
- only X is checked against the bed, and KizamuBeam warns when the design is taller than the object's circumference,
- with a separate axis, the axis is set to zero at the start (`G92 A0`, or B, C, Z), and the frame returns to the start afterwards,
- with the rotary on the Y port, KizamuBeam asks before homing (homing would turn the rotary).

## Tapered objects

Cups and many glasses are thinner at the bottom than at the top. Enter the object diameter at the left and the right edge of the job. The rotation then follows the diameter at each X position, so the engraving keeps its true size, and the middle of the job stays straight. With rollers, KizamuBeam assumes the object rests on its thicker end.

## Tips

- Place the design so its height (Y) is not larger than the circumference of the object (diameter × π).
- Focus on the highest point of the object, directly under the head.
- Do a frame first: the head moves along X and the object turns.
- Write the object diameter into the [project notes](materials-tests.md#project-notes), so the next run is quick.
