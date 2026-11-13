---
sidebar_position: 6
title: Extensions
description: Install extension packs with device presets, templates, materials and motifs.
---

# Extensions

Extension packs (`.kzp` files) add **device presets, templates, material library entries and library items** (motifs, images, design elements) to KizamuBeam, without a new version of the app.

## Installing an extension

1. Open **File → Extensions …**.
2. Either pick a pack from the **official catalogue** and install it with one click, or click **Install …** and choose a `.kzp` file. You can also drag a `.kzp` file onto the workspace.
3. The dialog lists what the pack contains and whether it is an update. Confirm to install.

After installing:

- templates appear under **File → New from template … → From extensions**,
- device presets appear in the device list, marked with the pack name,
- materials are copied into the material library,
- motifs and design elements appear in the library.

Removing a pack in the same window removes its entries again.

## Safety

A pack contains data only, never program code. KizamuBeam checks every entry before installing, and device presets from packs cannot bring start or end scripts or any other commands for your machine. The official catalogue is signed, and every pack in it is verified against its checksum.

## Official and third-party extensions

The official catalogue is published together with this manual and the website. A list of official and verified third-party extensions, with compatibility information, will follow here.

## Making your own pack

A pack is a single JSON file. The format is described in the developer documentation: [Extension packs](https://github.com/negurvulkan/kizamubeam/blob/main/docs/packs.md). Packs for the official catalogue are submitted as a pull request to the [`packs/`](https://github.com/negurvulkan/kizamubeam/tree/main/packs) folder.
