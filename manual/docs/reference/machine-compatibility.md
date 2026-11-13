---
sidebar_position: 3
title: Machine compatibility
description: Which lasers and controllers work with KizamuBeam.
---

# Machine compatibility

KizamuBeam talks directly to the controller of your laser and sends G-code. It works with most diode lasers and other machines whose controller runs one of these firmwares:

| Firmware | Connection | Notes |
|---|---|---|
| **FluidNC** | USB, Wi-Fi (Telnet, WebSocket) | Configuration editor, jobs from the controller’s SD card or flash, network search |
| **GRBL 1.1** | USB, Wi-Fi where the controller offers it | Real-time status and overrides |
| **grblHAL** | USB, network | Like GRBL |
| **Marlin** | USB | Sent line by line; position via M114 |
| **Smoothieware** | USB | Sent line by line; power from 0 to 1 |

Rotary attachments (roller or chuck, on the Y port or as a separate axis), a motorized Z axis and air assist are supported.

## Device templates

When you create a device, templates for common lasers fill in the work area and settings, for example Swiitol, Ortur, Atomstack, Sculpfun, xTool, Creality Falcon, Two Trees, Longer and Comgrow. For any other laser, choose the generic template for its controller. The [setup wizard](../getting-started/connect-laser.md) then reads the real values from the machine.

## Not supported (yet)

- **Ruida and other DSP controllers** (most CO₂ lasers): not supported yet.
- **Galvo lasers**: not supported.
- **Lasers with proprietary protocols**, such as some xTool models that only talk over the manufacturer’s network protocol.

## Tested by users

Reports from real machines help others. Tell us on [Discord](https://discord.gg/SSr8VHh7EJ) or in a [GitHub issue](https://github.com/negurvulkan/kizamubeam/issues) which laser you use with KizamuBeam and how well it works.
