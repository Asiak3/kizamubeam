---
sidebar_position: 4
title: Troubleshooting
description: Solutions for common problems when installing KizamuBeam and connecting a laser.
---

# Troubleshooting

## Installation

**macOS says the app cannot be checked or is damaged.**
The app is not notarized by Apple yet. Open **System Settings → Privacy & Security** and click **Open Anyway**, or run `xattr -cr /Applications/KizamuBeam.app` in the Terminal. See [Installation](../getting-started/installation.md#macos).

**Windows SmartScreen blocks the installer.**
Click **More info → Run anyway**. The installer is not code-signed yet.

## Connection

**The USB port does not show up.**
- Try another cable: some USB cables only charge and carry no data.
- Close other programs that might hold the port open (another laser program, a serial terminal).
- Windows: install the USB driver for your controller (often CH340 or CP210x).
- Linux: add your user to the `dialout` group, then log out and back in.

**The laser is not found over Wi-Fi.**
- Computer and laser must be in the same network.
- Enter the controller’s IP address instead of a name such as `fluidnc.local`.
- With FluidNC, try **Search …** next to the address field, or switch between Telnet and WebSocket.

**The machine reports an alarm after connecting.**
Many controllers start in alarm state until they are homed or unlocked. Home the machine if it has limit switches, otherwise unlock it in the Move window. The Laser window shows the alarm in plain language.

## Lasering

**The laser moves but does not fire, or only at full power.**
The power scale in KizamuBeam (S value for 100 %) must match the controller (`$30` on GRBL), and laser mode must be on (`$32=1`). The [setup wizard](../getting-started/connect-laser.md) detects both and offers to fix them.

**An axis moves the wrong way.**
Run step 4 (“Move”) of the setup wizard. It detects a reversed axis and suggests the right setting.

**KizamuBeam says the job does not fit on the bed.**
Before every job, KizamuBeam checks all moves against the work area. Check the job origin and the start mode in the Laser window (absolute coordinates, user origin or current position), and the work area in the device settings.

**The job stops when the Wi-Fi drops.**
With FluidNC, upload the job to the controller and run it from there (**Laser → FluidNC**).

## Still stuck?

Ask on [Discord](https://discord.gg/SSr8VHh7EJ) or open a [GitHub issue](https://github.com/negurvulkan/kizamubeam/issues). Mention your operating system, KizamuBeam version, laser and firmware.
