# External Worker Specification (`/process`)

This document outlines the API contract and responsibilities for the external worker that handles the complex image processing tasks for the BadRobot application.

## Endpoint

- **URL**: Configured via an environment variable (e.g., `WORKER_URL`) in the main web app.
- **Method**: `POST`
- **Content-Type**: `multipart/form-data`

## Request Payload (`multipart/form-data`)

The request will contain the following parts:

1.  **`metadata`** (Part 1, `application/json`)
    -   A JSON blob containing the overall job configuration.
    -   **Format**:
        ```json
        {
          "width": 1024,
          "height": 1024,
          "enforceFixedCanvas": true,
          "sequential": true,
          "pairs": [
            {
              "colorId": "#ef4444",
              "method": "extract", // "extract" or "generate" (after auto-routing)
              "sourceBBox": { "x": 100, "y": 150, "w": 300, "h": 250 },
              "referenceBBox": { "x": 50, "y": 80, "w": 320, "h": 260 }
            }
            // ... more pairs
          ]
        }
        ```

2.  **`source_image`** (Part 2, `image/*`)
    -   The original, full-size source image file (e.g., the t-shirt).

3.  **`reference_image`** (Part 3, `image/*`)
    -   The original, full-size reference image file (e.g., the clean design).

4.  **`source_mask_{index}`** (Part 4+, `image/png`)
    -   The 8-bit PNG mask for the source image for the pair at `metadata.pairs[index]`.
    -   The filename will be `source_mask_{colorId}.png`.

5.  **`reference_mask_{index}`** (Part 5+, `image/png`)
    -   The 8-bit PNG mask for the reference image for the pair at `metadata.pairs[index]`.
    -   The filename will be `reference_mask_{colorId}.png`.

## Worker Responsibilities

### 1. Pre-processing (Fixed-Canvas Contract)

-   Read the `width` (W) and `height` (H) from the metadata.
-   Calculate `S = max(W, H)`.
-   Create a new `S x S` transparent canvas.
-   Center-pad the `source_image` onto this canvas. This padded canvas becomes the "working canvas" for all sequential operations.

### 2. Sequential Pair Processing

-   Iterate through the `pairs` array in the order it is received.
-   For each pair, perform the operation specified by its `method`.

#### Method: `extract` (for text, logos)

1.  **Crop Patches**: Using the `sourceBBox` and `referenceBBox`, crop the corresponding regions from the full-size `source_image` and `reference_image`.
2.  **Geometric Fit**: Estimate a transformation (e.g., Homography, Thin Plate Spline) to warp the reference patch to the perspective of the source patch. Use keypoints (e.g., SIFT, ORB) detected *only within the masked areas* of the patches to guide the warp.
3.  **Photometric Match**: Perform color correction on the warped reference patch to match the lighting and color profile of the source patch. A Reinhard LAB color transfer using pixels from a "ring" around the source patch is recommended.
4.  **Seamless Blending**: Use a Poisson blend (`cv2.seamlessClone`) to insert the color-matched, warped patch back into the "working canvas" at the `sourceBBox` location. Use a feather of 2-4 pixels.
5.  **(Optional) Polish**: Perform a low-denoising pass using an image-to-image model (like Nano-Banana) on the blended patch with a prompt like: "Enhance edges and clarity only. Do not change layout, size, or boundaries. Preserve the underlying fabric texture."

#### Method: `generate` (for textures, decals)

1.  **Crop Patches**: Crop the source patch using `sourceBBox` from the "working canvas" and the reference patch using `referenceBBox` from the `reference_image`.
2.  **AI Inpainting**: Call an image editing model (e.g., Gemini / Nano-Banana) with the source crop as the base image, the reference crop as the style reference, and a prompt like: "Redraw only this crop to match the reference decal and color. Do not resize or move elements. Preserve surrounding fabric lighting and weave. The output must be the identical crop size."
3.  **Seamless Blending**: Use a Poisson blend to reinsert the AI-generated patch back into the "working canvas" at the `sourceBBox` location.

### 3. Post-processing

-   After processing all pairs, crop the `S x S` "working canvas" back to the original `W x H` dimensions.
-   The crop must be taken from the center to reverse the initial padding.

## Response

-   **Success**:
    -   **Status Code**: `200 OK`
    -   **Content-Type**: `image/png`
    -   **Body**: The final, corrected image file at the original `W x H` resolution.
-   **Failure**:
    -   **Status Code**: `4xx` or `5xx`
    -   **Content-Type**: `application/json`
    -   **Body**:
        ```json
        {
          "error": "A descriptive error message."
        }
        ```

## Required Libraries (Node.js Example)

-   `sharp`: For fast image I/O, padding, and cropping.
-   `opencv4nodejs`: For computer vision tasks like `seamlessClone`, keypoint detection, and homography.
-   `@google/generative-ai` or `axios`/`node-fetch`: For making calls to the Gemini API for the `generate` method.