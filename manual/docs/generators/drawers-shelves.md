---
sidebar_position: 4
title: Drawers, inserts and shelves
description: Drawers with carcass and front panel, divider inserts for boxes and drawers, and slot-together shelves without glue.
---

# Drawers, inserts and shelves

These generators build on the finger-jointed box and are in **Toolbox → Boxes and Furniture**. All of them are assemblies: the [3D view](../features/construction-3d.md#3d-view) shows them put together, and the tests behind them check that no parts overlap.

## Drawer

A drawer with a carcass open at the front, a matching drawer box and a front panel. Without the carcass you get just the drawer box, for an opening that already exists.

| Field | Meaning |
|---|---|
| **Width**, **Height**, **Depth** | Outer size of the carcass. Without carcass: size of the opening. |
| **Material thickness** | Thickness of the board. |
| **With carcass** | Builds the carcass too. |
| **Front panel** | **Overlay (covers the carcass)**, **Inset (inside the opening)** or **None**. |
| **Handle** | **Hand slot** or **Round hole**, with **Handle width** (slot length or hole diameter) and **Handle height**; or **None**. |
| **Side clearance**, **Top clearance**, **Back clearance** | Air between drawer box and carcass. |
| **Gap around the front panel** | The front panel is made this much smaller on every side. |
| **Kerf** | Width of the laser cut. |

**Finger width** and **Fit clearance** are under **Advanced**.

## Divider insert

A grid of halved dividers that slot into each other, for a box or drawer: for screws, beads, tea bags or game pieces.

| Field | Meaning |
|---|---|
| **Inner width** / **Inner depth** | Inner size of the box or drawer the insert goes into. |
| **Divider height** | Height of the dividers. |
| **Material thickness** | Thickness of the board. |
| **Compartments across** / **Compartments deep** | Number of compartments in each direction. |
| **Fit clearance** | Slots are made this much wider than the material thickness; negative = press fit. |
| **End clearance** | Dividers are made this much shorter than the inner size so the insert drops in easily. |
| **Kerf** | Width of the laser cut. |

## Slot-together shelf

Two sides and any number of shelves joined by cross slots: no glue, no screws.

| Field | Meaning |
|---|---|
| **Width** | Length of the shelves. |
| **Depth**, **Height** | Size of the sides. |
| **Material thickness** | Thickness of the board. 4 mm or more makes a stable shelf. |
| **Number of shelves** | 1 to 30. |
| **Lowest shelf above floor** | Height of the underside of the lowest shelf. |
| **Top shelf below top edge** | Distance from the top of the sides to the top face of the highest shelf. |
| **Shelf overhang** | How far the shelves stick out past the sides. |
| **Fit clearance** | Extra slot width; negative = press fit. |
| **Kerf** | Width of the laser cut. |

The shelves are evenly spaced between the lowest and the highest one.
