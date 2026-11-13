---
sidebar_position: 4
title: Generators
description: Generators create finished parts from a few dimensions, such as boxes, gears and slot-together models.
---

# Generators

Generators create finished parts from a few dimensions instead of drawing them by hand. They are all in the **Toolbox** (the tile button in the tools toolbar, or **Window → Toolbox**), sorted into groups and searchable.

Most generators create **parametric parts**: they keep their parameters in the project. Double-click a part later to change it, and everything is recalculated. Fields accept project parameters and formulas, so a box can follow the material thickness of a template, for example.

| Generator | What it makes |
|---|---|
| Spur gear and gear pair | Involute gears; a pair meshes at the right centre distance and turns in the 3D view |
| Rack | Straight gear rack matching the spur gear |
| Timing pulley | Pulleys for GT2 and HTD belts |
| Disc cam | Cams with rise, dwell and return for a roller or knife-edge follower |
| Finger-jointed box | Open or closed box with finger joints, kerf and fit clearance |
| Drawer | Carcass, drawer box and front panel, or just a drawer for an existing opening |
| Insert with compartments | A grid of halved dividers for a box or drawer |
| Slot-together shelf | Sides and shelves joined by cross slots, without glue or screws |
| Lid hinge | Knuckles with a pin that connect a lid to a box |
| Living hinges | Cut patterns that make a board bendable |
| Disc sphere | A sphere or lamp shade made of interlocking discs |
| Layered and rib models | Stacked or slotted sheets made from a 3D model (STL/OBJ) |

The [complete feature list](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.md#joints-generators-and-3d) describes every parameter. A dedicated reference page with examples for each generator will follow here.
