---
sidebar_position: 3
title: Features and tools
description: Overview of what KizamuBeam can do, from drawing to machine control.
---

# Features and tools

This chapter will get one page per topic. Until those pages are written, each section below summarizes the topic and links to the matching part of the [complete feature list](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.md), which describes every function with its menu path.

## Drawing and editing

Lines and Bézier curves, rectangles with corner radius, ellipses, polygons, stars and text with any font. Combine shapes with Boolean operations, offset them, edit nodes (across several objects at once), simplify and smooth paths, bend text along a path and round corners. Snapping, guides, relations such as concentric or parallel, and sketches with dimensions keep designs exact.
→ [Drawing and editing](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.md#drawing-and-editing), [Text, shapes and paths](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.md#text-shapes-and-paths)

## Layers and objects

The colour of an object is its layer, and the layer holds all laser settings: mode, speed, power, passes, fill, kerf offset, tabs and more. The Objects window shows every object per layer, with visibility, lock and “don’t laser”. Projects can have several pages.
→ [Layers, materials and tests](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.md#layers-materials-and-tests), [Projects and pages](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.md#projects-and-pages)

## Import and export

Open SVG, DXF, PDF and Illustrator files, LightBurn projects (`.lbrn2`) and all common image formats. Photos get dithering and other image modes, background removal, cropping and masks, and can be traced into vectors. Export to SVG, DXF, PDF, Illustrator and G-code. See also [File formats](../reference/file-formats.md).
→ [Import, images and tracing](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.md#import-images-and-tracing)

## Nesting

**Arrange → Nest …** arranges parts by their real outlines to save material, on the work area, on a material size or inside a scrap piece. Small parts can go into holes of larger ones.
→ [Drawing and editing](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.md#drawing-and-editing)

## 3D view and construction

**Window → 3D View** shows boxes, drawers, shelves and gear pairs assembled, with material and engravings, and marks parts that collide. Joints, slots and living hinges can be added to any shape, and 3D models (STL/OBJ) become layered, rib or disc models. See also [Generators](../generators/index.md).
→ [Joints, generators and 3D](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.md#joints-generators-and-3d)

## Materials and machine profiles

The material library stores proven settings per material and thickness. Material tests, focus tests and a fit calibration help you find them. Each laser is stored as a device with its own work area, connection and settings, created from templates for common lasers.
→ [Layers, materials and tests](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.md#layers-materials-and-tests), [Laser and machine](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.md#laser-and-machine)

## G-code and machine control

Connect over USB or Wi-Fi, frame, start, pause and adjust power and speed while lasering, start from any point of the job. KizamuBeam checks before every job that it fits on the bed. Rotary attachments, a motorized Z axis and air assist are supported. See [Connecting a laser](../getting-started/connect-laser.md).
→ [Laser and machine](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.md#laser-and-machine)

## Virtual Machine

The KizamuBeam Virtual Machine is a separate program that behaves like a FluidNC or GRBL laser. It shows the job in 3D, burns it into virtual material and has a virtual camera, so you can try jobs, camera functions and Print and Cut without hardware.
→ [Laser and machine](https://github.com/negurvulkan/kizamubeam/blob/main/docs/features.md#laser-and-machine)
