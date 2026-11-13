---
sidebar_position: 18
title: Virtual Machine
description: Try jobs, camera functions and Print and Cut without hardware with the KizamuBeam Virtual Machine.
---

# Virtual Machine

The **KizamuBeam Virtual Machine** is a separate program (a separate download on the [releases page](https://github.com/negurvulkan/kizamubeam/releases)) that behaves like a laser with a FluidNC 3.7 or GRBL 1.1 controller. Use it to learn KizamuBeam, to try a job before you waste material, or to test camera functions without a camera.

## Connecting

1. Start the Virtual Machine.
2. In KizamuBeam, add a device from the template **KizamuBeam Virtual Machine** and connect.

The Virtual Machine listens on Telnet (port 2323) and WebSocket (port 8181). The ports can be changed, and the machine can optionally be reached from the network. Other programs can connect to it as a GRBL or FluidNC network device.

## What it shows

- **Top view**: the bed with burn marks (darker with more power), rapid moves and the head with the laser spot.
- **3D view**: bed, frame, gantry, laser head and beam. Place workpieces with size, thickness, position and one of the 21 material looks. Every line burns into the material in real time: slower or stronger passes come out darker and deeper, and where the energy is enough, the material is cut through.
- **Parts**: as soon as a shape is cut all around, it becomes a loose part. Take it out, turn it over and inspect it. A part that still hangs on a spot that was not cut through is marked orange.
- **State**: positions, overrides, planner, run time, connections and a console.

The burn model is calibrated to a 10 W diode laser (100 % at 300 mm/min cuts 3 mm plywood). It is a model, not a measurement, so real materials still need a [material test](materials-tests.md#material-test).

## Like a real machine

The Virtual Machine emulates the receive buffer, the motion planner with acceleration, real-time commands (hold, resume, reset, overrides, air assist), homing, jogging, work offsets and alarms. It tells you when a program overfills the receive buffer, and when the head runs into the frame it loses its position like a real machine. **Power cycle** switches it off and on.

## Virtual camera

The Virtual Machine renders a camera image of its 3D scene, from above the bed or from the laser head, and serves it like a network camera (MJPEG stream at `http://…:8282/stream`). In KizamuBeam, add it as a network camera in the [Camera](camera.md) window to try calibration, workpiece detection and [Print and Cut](print-and-cut.md) without hardware.

## Ruida mode

The Virtual Machine can also answer like a Ruida controller (as used in many CO2 lasers) over UDP. This is meant for testing other programs that speak Ruida; KizamuBeam itself does not support Ruida controllers yet.

## Window

The sidebar can be resized, hidden (Ctrl+B, ⌘B on the Mac) and placed left or right. Theme and language are under **Settings → View**.
