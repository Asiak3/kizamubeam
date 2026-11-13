---
sidebar_position: 5
title: Frequently asked questions
description: Answers to common questions about KizamuBeam.
---

# Frequently asked questions

## Is KizamuBeam really free?

Yes. KizamuBeam is licensed GPL-3.0-or-later: no license fee, no subscription, no account, commercial use included.

## Will it work with my laser?

If it runs FluidNC, GRBL, grblHAL, Marlin or Smoothieware, very likely; that covers most diode lasers. Galvo lasers and Ruida/DSP controllers are not supported. See [Machine compatibility](machine-compatibility.md).

## Why does my computer warn me when I install it?

The installers are not code-signed yet, which is common for young open-source projects. See [Installation](../getting-started/installation.md).

## Can I bring my existing material settings and projects?

Yes. LightBurn material libraries (`.clb`) can be imported where fields have an equivalent, and LightBurn projects (`.lbrn2`) open with their shapes, images and layer settings. SVG, DXF, PDF and Illustrator (`.ai`) files import as usual. See [File formats](file-formats.md).

## Is KizamuBeam stable enough for real projects?

Yes. Since version 2.2.0 there are stable releases, and KizamuBeam is used on real hardware every day. As with any laser software: check new jobs with preview and frame, and back up important projects.

## What is the MCP server about?

It lets AI agents read and edit your designs. It is off by default, local only and token-protected, and nothing reaches your machine without your confirmation in KizamuBeam.

## How can I help?

Try KizamuBeam on your laser, report bugs and ideas on [GitHub](https://github.com/negurvulkan/kizamubeam/issues), ask questions and share your projects on [Discord](https://discord.gg/SSr8VHh7EJ), translate the interface or [this manual](../contributing.md), or send a pull request.
