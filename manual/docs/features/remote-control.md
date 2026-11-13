---
sidebar_position: 17
title: Remote control
description: Use a laser that is connected to another computer running KizamuBeam, over the home network or a VPN.
---

# Remote control

The laser often stands in the workshop, while you design at your desk. With remote control, the computer next to the laser runs KizamuBeam in **host mode**, and other computers use that laser as if it were connected to them.

## Setting up the host

On the computer that is connected to the laser:

1. Connect the laser as usual (see [Connecting a laser](../getting-started/connect-laser.md)).
2. Choose **Laser → Remote control → Host mode …** and switch host mode on. It is off by default.
3. Optionally tick **Confirm remote job starts on this computer**, so every remote start has to be confirmed at the laser.

The host listens on port 47900. The connection is encrypted.

## Pairing a computer

On the other computer:

1. Add a device (**Laser → Device → Devices …**) with the connection **Other KizamuBeam (network)**.
2. Click **Find host …** to find hosts in the network, or enter the host's address (over a VPN such as Tailscale or WireGuard, enter it by hand).
3. Click **Pair …**. The host shows a 6-digit code; type it in on this computer.

The host lists all paired computers and can remove them or change their role:

| Role | May |
|---|---|
| **Operator** | move, frame, start, pause and stop |
| **Viewer** | only watch status, progress and console |

## Running jobs remotely

**Start** does not send G-code. It sends the project (layers, cut settings, images) and the fonts it uses. The host computes the job with its own device settings and runs it over its own connection. Before the laser starts, you see the host's preview, the estimated time and any warnings (work area, missing fonts, air assist).

Frame, contour frame, material test, focus test and the setup test job work the same way. Jogging, homing, console, overrides, pause and stop go straight to the host's machine. Status and progress reach every connected computer, and a network dropout never interrupts a running job: the host keeps going. Whoever stands at the host can always pause or stop.

A remote start is refused while the host's machine is busy or not connected. **Start Here** and raw G-code from the client are not possible yet.

## Remote jobs on the host

**Laser → Remote control → Remote jobs …** on the host lists the last 20 received jobs with preview, sender and time. Start one again (it is computed anew with the current settings) or **Open in editor** as a normal project.

## Taking over settings from the host

**Laser → Remote control → Take over from host …** copies the host's device settings onto your device (name and connection stay), merges the host's material library and adds the host's cameras with their calibration. The camera image then comes through the connection, a few frames per second.
