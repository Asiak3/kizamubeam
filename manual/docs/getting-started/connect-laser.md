---
sidebar_position: 4
title: Connecting a laser
description: Connect a GRBL, grblHAL, FluidNC, Marlin or Smoothieware laser over USB or Wi-Fi with the setup wizard.
---

# Connecting a laser

KizamuBeam works with lasers whose controller runs **FluidNC, GRBL, grblHAL, Marlin or Smoothieware**. That covers most diode lasers. See [Machine compatibility](../reference/machine-compatibility.md) for details.

## The Laser Setup wizard

The easiest way is the setup wizard: **Laser → Laser Setup …**, or the button in the Laser window. On the very first start of the app it opens by itself. It guides you in five steps from the first connection to a first, safe test job.

```mermaid
flowchart LR
  A[1. Connect] --> B[2. Detect]
  B --> C[3. Check]
  C --> D[4. Move]
  D --> E[5. Test job]
```

1. **Connect**: pick a device template for your laser or a generic one for your controller, then choose USB or network and connect. KizamuBeam never homes the machine when connecting.
2. **Detect**: KizamuBeam asks the controller for its firmware and version and reads its settings, such as the work area, the power scale and the laser mode.
3. **Check**: problems are listed in plain language, for example a different work area, laser mode switched off or homing without limit switches. Settings in KizamuBeam can be applied with one click. Changes on the controller are only suggested, together with the command to undo them, and are sent only after you confirm.
4. **Move**: the head moves along X and Y with the laser off, and you say where it went. A reversed axis gets a suggested fix.
5. **Test job**: a small square with a circle at low power, with preview and frame. It starts only after you have confirmed that material and focus, frame, eye protection and exhaust are in order.

## USB

Connect the laser with a USB cable, choose **USB** in the wizard or in the Laser window and pick the port. The baud rate is set in the device settings (115200 for most controllers).

- **Windows**: some controllers need a USB driver (often CH340 or CP210x) from the laser’s manufacturer.
- **Linux**: your user needs access to serial ports, see [Installation](installation.md#linux).

## Wi-Fi

Controllers with Wi-Fi, such as FluidNC, are reached over the network:

- **Telnet** on port 23, or
- **WebSocket** on port 81 (FluidNC; port 80 is tried if 81 does not answer).

Enter the address of the controller, for example `192.168.1.50` or `fluidnc.local`. **Search …** next to the address field finds FluidNC controllers on your local network.

:::tip Unstable Wi-Fi
With FluidNC, a job can be uploaded to the controller’s SD card or flash and run from there (**Laser → FluidNC**). A Wi-Fi dropout then no longer stops the job.
:::

## Several devices

Each laser is stored as a device with its own work area, connection and settings. Switch between them at the top of the Laser window or under **Laser → Device → Devices …**. Device templates exist for many common lasers (for example Swiitol, Ortur, Atomstack, Sculpfun, xTool, Creality Falcon, Two Trees, Longer and Comgrow); the workspace always shows the bed of the selected device.

## Without a laser

The **KizamuBeam Virtual Machine** is a separate program that behaves like a FluidNC or GRBL controller and shows the job in 3D, burning into virtual material. Download it from the [releases page](https://github.com/negurvulkan/kizamubeam/releases?q=vm-v) and connect with the device template “KizamuBeam Virtual Machine”.
