---
sidebar_position: 7
title: Images and tracing
description: Engrave photos with dithering and other image modes, adjust them, remove backgrounds, crop and mask, and trace images into vectors.
---

# Images and tracing

## Importing images

**File → Import** (Ctrl+I), drag and drop or paste (Ctrl+V) brings in PNG, JPG, BMP, GIF, WebP and TIFF images. The size comes from the resolution stored in the file (254 DPI if none is given); oversized images are scaled down to the bed.

An image sits on a layer like every other object. Speed, power, passes, line interval and the other laser settings come from the layer; double-click the image to open the layer settings with their **Image** section.

## Image modes

Each image has its own **Image Mode**, which decides how grey tones become laser dots. The workspace shows the result at laser resolution.

| Mode | Good for |
|---|---|
| **Threshold** | Logos and line art: everything darker than the threshold is lasered. |
| **Ordered** | Even, regular dot pattern. |
| **Floyd-Steinberg**, **Atkinson**, **Stucki**, **Jarvis** | Photos. Error-diffusion dithering with different looks; Atkinson keeps more contrast, Stucki and Jarvis give finer transitions. |
| **Newsprint** | A round dot per screen cell whose size follows the brightness, with adjustable cells per inch and screen angle. |
| **Halftone** | Classic halftone look. |
| **Sketch** | Turns edges into dark strokes and leaves even areas blank. |
| **Grayscale** | Varies the power between Min and Max Power of the layer; for materials that darken evenly. |

**Negative Image** inverts the image, for example for dark materials that turn light when lasered.

## Adjusting images

**Tools → Image → Adjust Image …** sets brightness, contrast, gamma, sharpening (with radius) and denoise, with a preview, a comparison with the original and a 1:1 view. Adjustments and image mode can be saved as named presets.

**Save Processed Bitmap …** saves the image as PNG exactly as it would be lasered.

## Removing the background

**Tools → Image → Remove Background …** (or **Remove BG …** in the toolbar) works locally, without a cloud service. The background colours are taken from the image border, or you click them in the preview (Shift+click adds more). Colours within the tolerance become transparent and are not lasered. Clean-up removes small specks and fills small holes; **Crop to subject** trims the image.

## Cropping and masking

Select an image and one or more closed shapes:

- **Tools → Image → Crop image** trims the image to the bounding box of the shape.
- **Tools → Image → Apply mask to image** keeps only the inside of the shapes (text works too); the rest becomes transparent.

The image keeps its position and resolution; Ctrl+Z undoes both.

## Tracing images

**Tools → Image → Trace Image …** (Alt+T) turns an image into vector paths, with a live preview. Set the threshold, ignore small specks and choose the smoothing. The result is Bézier paths with preserved corners.

The type **Centerlines** traces strokes along their middle as open paths. That is the right choice for handwriting, signatures and line drawings that should be scored as a single line instead of cut around.

After tracing, [Simplify / smooth paths](paths.md#simplifying-paths) reduces the number of nodes if needed.
