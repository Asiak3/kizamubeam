---
sidebar_position: 3
title: Engraving a photo on wood
description: Prepare a photo, choose an image mode and find the right settings to engrave it on plywood or another light wood.
---

# Engraving a photo on wood

In this tutorial you engrave a portrait or a pet photo on a piece of light wood, such as poplar plywood, birch or basswood. Photo engraving is mostly about two things: preparing the image and finding the right speed and power.

**You need:** a photo with good contrast (a face in even light works best), a piece of light, smooth wood, and a scrap of the same wood for the test.

## 1. Import the photo

1. Choose **File → Import** (Ctrl+I) and pick the photo, or drag it onto the workspace.
2. Scale it to the size you want, for example 100 mm wide. Lock the aspect ratio so the picture is not distorted.
3. Put the image on its own layer by clicking a palette colour.

## 2. Prepare the image

1. **Remove the background** if the subject should stand alone: **Tools → Image → Remove Background …**. Click the background in the preview, adjust the tolerance and tick **Crop to subject**.
2. **Adjust the image**: **Tools → Image → Adjust Image …**. Wood darkens quickly, so most photos need more brightness and contrast than you would expect. Raise the contrast until the face has clear light and dark areas, and sharpen a little. Use the comparison with the original and the 1:1 view.
3. To give the photo a shape, draw an ellipse or a rounded rectangle over it, select both and choose **Tools → Image → Apply mask to image**.

## 3. Choose an image mode

Double-click the image to open the layer settings with the **Image** section, and choose the **Image Mode**:

- **Atkinson** or **Floyd-Steinberg** are the safe choice for photos on wood. Atkinson keeps more contrast, which suits wood well.
- **Grayscale** varies the power instead of setting dots. It only works well on materials that darken evenly, and needs a careful test.
- **Newsprint** gives a round-dot look that suits large pictures seen from further away.

The workspace shows the result at laser resolution; zoom in to judge it.

Set the **line interval** to suit your laser's spot, typically 0.08 to 0.1 mm for a diode laser (about 250 to 300 lines per inch). A finer interval than the spot only makes the picture darker and muddier. Set an **Overscan** so the edges of the picture are not darker.

## 4. Find the settings with a material test

1. Choose **Laser → Tests and Calibration → Material Test …**.
2. Set up a grid for engraving, for example speed in the rows and power in the columns, with the same line interval as the photo.
3. Run the test on the scrap of the same wood.
4. Pick the cell that is dark but not burned. **Evaluate Material Test …** can do this from a photo of the test.

Apply the values to the image layer, or save them in the material library for next time. More in [Materials and tests](../features/materials-tests.md#material-test).

## 5. Engrave

1. Look at the preview (Alt+P) and check the time: a photo takes much longer than text.
2. Focus carefully: a blurred spot makes a blurred picture. The [focus test](../features/materials-tests.md) helps.
3. Place the wood, frame and start. Keep the exhaust running, because engraving wood makes a lot of smoke.

## If it does not look right

| Problem | Try |
|---|---|
| Too dark, details are lost | More brightness in Adjust Image, a larger line interval, or less power. |
| Too pale, little contrast | More contrast, or more power or less speed. |
| Lines or stripes | Check that the belts are tight and the line interval is not finer than the spot. Overscan avoids darker edges. |
| Brown haze around the picture | Mask the wood with tape before engraving, or wipe it with a damp cloth afterwards. |

For dark materials that turn light when lasered, such as anodised aluminium or painted slate, tick **Negative Image**.
