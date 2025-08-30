/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import express from "express";
import multer from "multer";
import cors from "cors";
import sharp from "sharp";
import { GoogleGenAI, Modality } from "@google/genai";

const app = express();
app.use(cors());
app.use(express.json());

// --- Health and Status Routes ---
// Fast, lightweight routes for Cloud Run health checks and basic status.
app.get("/", (_req, res) => res.send("BadRobot AI worker is running. Use POST /process to submit a job."));
app.get("/health", (_req, res) => res.json({ ok: true }));


const COLORS = ['red', 'green', 'blue', 'yellow', 'cyan'];

// --- Multer Setup ---
const multerFields = [
  { name: 'source_image', maxCount: 1 },
  { name: 'reference_image', maxCount: 1 },
];
COLORS.forEach(color => {
  multerFields.push({ name: `source_mask_${color}`, maxCount: 1 });
  multerFields.push({ name: `reference_mask_${color}`, maxCount: 1 });
});
const upload = multer({ 
    storage: multer.memoryStorage(), 
    limits: { fileSize: 25 * 1024 * 1024 } 
}).fields(multerFields);


// --- Gemini AI Setup ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const geminiModel = 'gemini-2.5-flash-image-preview';


// --- Image Processing & Validation Helpers ---

/**
 * Counts the number of separate connected components (blobs) in a mask image.
 * @param {Buffer} buffer The image buffer for the mask.
 * @returns {Promise<number>} The number of blobs found.
 */
async function countBlobs(buffer) {
    try {
        const image = sharp(buffer);
        const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
        const { width, height, channels } = info;
        const visited = new Uint8Array(width * height);
        let blobCount = 0;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = y * width + x;
                const pixelIsMarked = data[index * channels] > 128; // Check R channel for white

                if (pixelIsMarked && visited[index] === 0) {
                    blobCount++;
                    const queue = [[x, y]];
                    visited[index] = 1;
                    while (queue.length > 0) {
                        const [cx, cy] = queue.shift();
                        const neighbors = [[cx, cy - 1], [cx, cy + 1], [cx - 1, cy], [cx + 1, cy]];
                        for (const [nx, ny] of neighbors) {
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                const nIndex = ny * width + nx;
                                if (visited[nIndex] === 0 && data[nIndex * channels] > 128) {
                                    visited[nIndex] = 1;
                                    queue.push([nx, ny]);
                                }
                            }
                        }
                    }
                }
            }
        }
        return blobCount;
    } catch (error) {
        console.error("Error in countBlobs:", error);
        return -1; // Indicate an error
    }
}

// Error helpers
function badRequest(detail, error = "Bad Request") {
  const err = new Error(error);
  err.status = 400;
  err.detail = detail;
  return err;
}

// --- Main Processing Route ---

app.post("/process", (req, res, next) => {
    upload(req, res, async (err) => {
        if (err) return next(err); // Forward multer errors
        try {
            console.log("---- /process request ----");
            const files = req.files;

            // 1. === Basic Validation ===
            if (!files.source_image?.[0]) throw badRequest("Missing required file: source_image");
            if (!files.reference_image?.[0]) throw badRequest("Missing required file: reference_image");

            const sourceImageFile = files.source_image[0];
            const referenceImageFile = files.reference_image[0];
            
            const usedColors = COLORS.filter(c => files[`source_mask_${c}`] || files[`reference_mask_${c}`]);

            if (usedColors.length === 0) {
                throw badRequest("No masks provided. Please paint at least one color on both images.");
            }

            // 2. === Per-Color Mask Validation ===
            for (const color of usedColors) {
                const sourceMaskFile = files[`source_mask_${color}`]?.[0];
                const refMaskFile = files[`reference_mask_${color}`]?.[0];
                
                if (!sourceMaskFile || !refMaskFile) {
                    throw badRequest(`Missing masks for color '${color}'. Need both source_mask_${color} and reference_mask_${color}.`);
                }
                
                const sourceBlobCount = await countBlobs(sourceMaskFile.buffer);
                if (sourceBlobCount !== 1) {
                    throw badRequest(`Invalid mask: Color '${color}' must contain exactly one region on the source canvas, but found ${sourceBlobCount}.`);
                }

                const refBlobCount = await countBlobs(refMaskFile.buffer);
                if (refBlobCount !== 1) {
                    throw badRequest(`Invalid mask: Color '${color}' must contain exactly one region on the reference canvas, but found ${refBlobCount}.`);
                }
            }

            // 3. === AI Processing Pipeline ===
            let workingCanvas = sharp(sourceImageFile.buffer);
            const sourceMeta = await workingCanvas.metadata();

            for (const color of usedColors) {
                console.log(`Processing color: ${color}`);
                const sourceMask = sharp(files[`source_mask_${color}`][0].buffer);
                const referenceMask = sharp(files[`reference_mask_${color}`][0].buffer);

                // Get bounding boxes
                const sourceStats = await sourceMask.stats();
                const refStats = await referenceMask.stats();
                
                // dominant will be white, so we can get its coordinates
                const sourceCrop = { left: sourceStats.channels[0].minX, top: sourceStats.channels[0].minY, width: sourceStats.channels[0].maxX - sourceStats.channels[0].minX + 1, height: sourceStats.channels[0].maxY - sourceStats.channels[0].minY + 1 };
                const refCrop = { left: refStats.channels[0].minX, top: refStats.channels[0].minY, width: refStats.channels[0].maxX - refStats.channels[0].minX + 1, height: refStats.channels[0].maxY - refStats.channels[0].minY + 1 };
                
                // Pad bboxes slightly
                const padding = 8;
                sourceCrop.left = Math.max(0, sourceCrop.left - padding);
                sourceCrop.top = Math.max(0, sourceCrop.top - padding);
                sourceCrop.width = Math.min(sourceMeta.width - sourceCrop.left, sourceCrop.width + padding * 2);
                sourceCrop.height = Math.min(sourceMeta.height - sourceCrop.top, sourceCrop.height + padding * 2);

                // Crop patches
                const sourcePatchBuffer = await workingCanvas.clone().extract(sourceCrop).png().toBuffer();
                const refPatchBuffer = await sharp(referenceImageFile.buffer).extract(refCrop).png().toBuffer();
                const sourceMaskCropBuffer = await sourceMask.extract(sourceCrop).png().toBuffer();

                // Call Gemini
                const prompt = "Recreate the content from the reference patch and realistically adapt it into the source patch region. Preserve shirt/fabric geometry, wrinkles, perspective, and local lighting/shadows. Confine changes to the masked region only; do not alter the surrounding pixels.";
                
                const response = await ai.models.generateContent({
                    model: geminiModel,
                    contents: {
                        parts: [
                            { text: prompt },
                            { inlineData: { mimeType: 'image/png', data: sourcePatchBuffer.toString('base64') } },
                            { inlineData: { mimeType: 'image/png', data: sourceMaskCropBuffer.toString('base64') } },
                            { inlineData: { mimeType: 'image/png', data: refPatchBuffer.toString('base64') } },
                        ]
                    },
                    config: { responseModalities: [Modality.IMAGE] }
                });

                const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
                if (!imagePart?.inlineData) {
                    const feedback = response.promptFeedback || response.candidates?.[0]?.finishReason;
                    throw new Error(`AI did not return an image for color '${color}'. Reason: ${JSON.stringify(feedback)}`);
                }

                const generatedPatchBuffer = Buffer.from(imagePart.inlineData.data, 'base64');

                // Feather mask and composite back
                const featheredMask = await sharp(sourceMaskCropBuffer).blur(2).toBuffer();
                
                workingCanvas = workingCanvas.composite([{
                    input: generatedPatchBuffer,
                    blend: 'over',
                    top: sourceCrop.top,
                    left: sourceCrop.left,
                    premultiplied: true,
                }, {
                    input: featheredMask,
                    blend: 'dest-in', // Use mask as alpha channel for the composite operation
                    top: sourceCrop.top,
                    left: sourceCrop.left,
                }]);
            }
            
            // 4. === Final Output ===
            const finalPngBuffer = await workingCanvas.png().toBuffer();
            res.set("Content-Type", "image/png");
            console.log(`OK: sending PNG ${sourceMeta.width}x${sourceMeta.height} after processing ${usedColors.length} color(s).`);
            res.send(finalPngBuffer);

        } catch (err) {
            next(err); // Forward to global error handler
        }
    });
});


// Global error handler
app.use((err, _req, res, _next) => {
    console.error("Worker error:", err);
    const status = err.status || 500;
    res.status(status).json({ 
        error: err.message || "Processing failed",
        detail: err.detail || String(err) 
    });
});

// --- Server Startup ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Worker listening on port ${PORT}`);
});
