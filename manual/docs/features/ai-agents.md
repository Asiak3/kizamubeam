---
sidebar_position: 20
title: AI agents (MCP)
description: Let an AI assistant such as Claude read and change your design through the Model Context Protocol, with you in control of the laser.
---

# AI agents (MCP)

KizamuBeam can be controlled by an AI assistant through the **Model Context Protocol (MCP)**. The assistant can read your project, draw, run generators, check the design and, if you allow it, ask the laser to start. Every machine action still needs your confirmation in KizamuBeam.

## Switching it on

Open **File → AI Agents (MCP) …**. Access is off by default.

1. Switch the server on. It runs only on your own computer, at `http://127.0.0.1:47800/mcp`, and is not reachable from the network.
2. Choose the access level (see below).
3. Copy the token and the configuration into your AI client.

For clients that only speak stdio, start the bridge with `kizamubeam --mcp-stdio`.

## Access levels

| Level | The assistant may |
|---|---|
| **Read only** | read the document, layers, materials, devices and fonts, get a preview image and a time estimate |
| **Read and design** | additionally create and change objects: shapes, text, QR codes and barcodes, Boolean operations, offset, path tools, arrays, nesting, joints, living hinges, pattern fill, generators, 3D models, parameters, templates, the library, series, layers, pages and files |
| **Also generate G-code** | additionally create G-code, without sending it to the machine |
| **Also operate the laser** | additionally connect, pause, stop and request a job, a frame or homing |

The laser level lasts only until KizamuBeam is closed.

## Safety

- An assistant never sends raw G-code to the laser. It can only *request* a job, a frame or homing, which starts only after you confirm it in KizamuBeam.
- Jobs must stay inside the work area and the device limits.
- Pause and stop always work.
- Every machine action is logged.

## Undo

Each call of the assistant is one step in the undo history, named after the tool it used. Use **Ctrl+Z** or the History window to go back.

## Ideas

- "Make a finger-jointed box with an inside size of 120 × 80 × 60 mm from 3 mm plywood."
- "Check the design and fix what you can."
- "Put the names from this list on name tags, one page each."
- "Turn this STL file into a rib model."
