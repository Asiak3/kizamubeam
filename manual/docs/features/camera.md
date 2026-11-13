---
sidebar_position: 14
title: Camera
description: Show the bed in the workspace with a USB or network camera, calibrate it, and place designs on workpieces automatically.
---

# Camera

With a camera above the bed, you see the material right under your design and can place the design exactly where it belongs.

## Choosing a camera

Open the **Camera** window and choose a camera:

- a **USB camera**, or
- a **network camera** that delivers an MJPEG stream or single images over `http://`, for example an ESP32-CAM or the virtual camera of the [Virtual Machine](virtual-machine.md).

The image is undistorted and placed under the objects on the workspace. You can set its opacity and update it once or continuously. **Insert as Image** puts the current picture on the T1 layer, for example to trace it. On macOS the system asks for camera permission on the first connection.

A device can have several cameras, each with its own calibration, all shown at the same time.

## Calibrating

The camera has to learn where the bed is in its picture:

1. Start the calibration in the Camera window.
2. Let the laser mark a grid of markers (2 × 2 up to 5 × 5) on a piece of scrap, or save the markers as G-code.
3. Take a picture and click each marker in the photo.

KizamuBeam computes the placement and, from 3 × 3 markers, the lens distortion. It shows the remaining error in mm and an undistorted check view. The calibration dialog has its own controls to connect, home and jog the machine.

Calibrations can be exported as a `.kzb-camera` file and imported on another computer with the same camera and mounting.

## Adjusting the image

The Camera window can shift, stretch and rotate the overlay slightly without a new calibration, and adjust brightness, contrast, saturation and gamma or show the image in grey. These settings only change the display, not the calibration.

## Head camera

A camera on the laser head sees only a small area. KizamuBeam calibrates it with small markers around the head position and places each picture at the head position where it was taken. **Capture bed** or **Capture selection** moves the head over the area (laser off) and stitches the pictures together. The field of view is shown dashed at the head position.

## Place on workpieces

**Place on workpieces** (in the Camera window, or **Toolbox → Copy and Arrange**) finds identical workpieces in the camera image and puts the selected design on each of them, in the right position and rotation.

1. Lay the workpieces on the bed and take a picture.
2. Select your design. Either draw the workpiece outline around it (the outline can lie anywhere, for example next to the bed), or put the design on one of the detected workpieces.
3. In the dialog, click workpieces to include or exclude them, turn them by 90° or 180°, and check the dashed orange preview on the workspace.

Workpieces are separated from the bed by brightness, or more reliably with a remembered photo of the empty bed. Sensitivity and minimum size are adjustable. Options: also place the outline, hide the template afterwards, group per workpiece. One undo step.

For batches with a fixed layout, a [jig](print-and-cut.md#jigs) is often more precise.
