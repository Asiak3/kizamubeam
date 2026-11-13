---
sidebar_position: 1
title: Gears and racks
description: Involute spur gears, gear pairs at the right centre distance, and matching racks.
---

# Gears and racks

The gear generators make real involute teeth, generated the way a hob cuts them, with exact root fillets and undercut for small tooth counts. The outlines are Bézier curves within 0.004 mm of the true shape. Find them in **Toolbox → Mechanics**.

## Gear

| Field | Meaning |
|---|---|
| **Number of teeth** | 5 to 400. |
| **Module** | Pitch diameter divided by the number of teeth. Meshing gears need the same module. The pitch diameter is module × teeth: 24 teeth at module 2 give 48 mm. |
| **Pressure angle** | 20° is common. Meshing gears need the same angle. |
| **Backlash** | Play of the gear pair on the pitch circle; each gear's teeth get thinner by half of it. |
| **Kerf** | Width of the laser cut; the outline is offset outward by half of it, the bore inward. |
| **Bore** | None, **Round**, **D-shaft (flat)** with the size across the flat, or **With keyway** with keyway width and depth. |

Under **Advanced**:

- **Profile shift x**: positive values make the tooth roots stronger and avoid undercut on small gears; the centre distance changes by x × module.
- **Root fillet** and **Bottom clearance** (× module): standard values are 0.38 and 0.25.

Backlash and kerf are separate on purpose: backlash makes room between the teeth of two gears, the kerf makes up for the material the laser removes.

## Gear pair

**Gear pair** creates two matching gears at the right centre distance, as one assembly. In the [3D view](../features/construction-3d.md#3d-view) they mesh and can turn.

| Field | Meaning |
|---|---|
| **Teeth gear 1** / **Teeth gear 2** | The ratio is teeth 2 ÷ teeth 1. |
| **Module**, **Pressure angle**, **Backlash**, **Kerf** | As for a single gear. |
| **Base plate with axle holes** | Adds a plate with both axle holes at the right distance, with **Axle hole diameter** and **Base plate margin** around the tip circles. |
| **Bore** | Per gear. |

**Profile shift gear 1** (Advanced) shifts the small gear; gear 2 gets the opposite shift, so the centre distance stays the same.

## Rack

A **Rack** is a straight gear that meshes with a spur gear: rotation becomes linear motion.

| Field | Meaning |
|---|---|
| **Number of teeth** | Length of the rack in teeth (the length is teeth × module × π). |
| **Module**, **Pressure angle** | Must match the gear. |
| **Backlash** | Split between rack and gear. |
| **Backing height** | Material below the tooth roots. |
| **Kerf** | As for the gear. |

## Tips

- Plywood and acrylic from 3 mm work well from module 1.5 up. Smaller modules need a thin, precise beam.
- Cut a gear pair and test it on two pins before making a larger mechanism; adjust the backlash if it binds.
- Put a pin through the centre bore instead of relying on the bore of plywood alone: wood wears quickly.
