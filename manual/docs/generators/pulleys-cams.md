---
sidebar_position: 2
title: Pulleys and cams
description: Timing pulleys for GT2 and HTD belts, and disc cams with a choice of motion law and follower.
---

# Pulleys and cams

Both generators are in **Toolbox → Mechanics**.

## Timing pulley

A **Pulley** for toothed belts, with the outside diameter calculated from the pitch and the pitch line offset of the belt.

| Field | Meaning |
|---|---|
| **Belt profile** | GT2 (2, 3 or 5 mm pitch) or HTD (3M, 5M). |
| **Number of teeth** | 8 to 400. |
| **Groove clearance** | Widens every groove so the belt runs in easily (negative values make it tighter). |
| **Kerf** | Width of the laser cut. |
| **Bore** | None, round, D-shaft or with keyway, as for gears. |

The grooves are round, with the usual groove depth and width for the profile. A belt pulley is usually cut from several layers glued together, with a larger disc on each side as a flange.

## Disc cam

A **Cam** turns rotation into a lifting motion of a follower: for automata, toys and simple mechanisms. One revolution is split into rise, dwell at the top, return and dwell at the bottom.

| Field | Meaning |
|---|---|
| **Base circle radius** | Smallest radius of the cam: the follower is at its lowest here. |
| **Lift** | How far the follower rises. |
| **Rise angle** | Rotation over which the follower rises. |
| **Dwell at top** | Rotation over which it stays at the top. |
| **Return angle** | Rotation over which it falls again. The rest of the turn is the dwell at the bottom. |
| **Motion law** | **Cycloidal (low jerk)**, **5th-degree polynomial** or **Harmonic**. Cycloidal runs smoothest. |
| **Follower** | **Roller** (with **Roller diameter**) or **Knife edge**. |
| **Kerf** | Width of the laser cut. |
| **Bore** | As for gears. |

The dialog checks the pressure angle and the roller size: if the cam is too steep for the follower, or the roller too large for a hollow in the cam, a warning appears. A larger base circle or a longer rise angle helps.
