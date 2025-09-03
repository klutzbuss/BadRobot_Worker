/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import express from "express";
import multer from "multer";
import cors from "cors";
import sharp from "sharp";
import { GoogleGenerativeAI, Modality } from "@google/generative-ai";

const app = express();
app.use(cors());
app.use(express.json());

// --- Health and Status Routes ---
app.get('/', (_req, res) => res.type('text/plain').send('BadRobot worker is running. Use POST /process to submit a job.'));
app.get('/health', (_req, res) => res.json({ ok: true, time: Date.now() }));

// --- Error Helper ---
function badRequest(detail, error = "Bad Request") {
    const err = new Error(error);
    err.status = 400;
    err.detail = detail;
    return err;
}

// --- Multer Setup ---
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

// --- Gemini AI Setup ---
if (!process.env.API_KEY) {
    // Fallback to the key name from the prompt for compatibility, but prefer the standard name.
    if (!process.env.GENAI_API_KEY) {
        throw new Error("API_KEY or GENAI_API_KEY environment variable is not set.");
    }
    process.env.API_KEY = process.env.GENAI_API_KEY;
}

const ai = new GoogleGenerativeAI({ apiKey: process.env.API_KEY });
const MODEL_ID = 'gemini-2.5-flash-image-preview'; // aka "nano-banana"

/**
 * Helper to normalize an image buffer to PNG format.
 * @param {Buffer} buffer The input image buffer (e.g., JPEG, WEBP).
 * @returns {Promise<Buffer>} The image buffer in PNG format.
 */
async function toPng(buffer) {
    return sharp(buffer).png().toBuffer();
}

// --- Main Processing Route ---
app.post("/process", upload.any(), async (req, res, next) => {
    try {
        console.log("---- /process request ----");
        const files = req.files || [];
        console.log("Fieldnames received:", files.map(f => f.fieldname));

        // 1. === File Validation ===
        const sourceImageFile = files.find(f => f.fieldname === 'source_image');
        const referenceImageFile = files.find(f => f.fieldname === 'reference_image');
        
        if (!sourceImageFile) throw badRequest("Missing required file: source_image");
        if (!referenceImageFile) throw badRequest("Missing required file: reference_image");
        
        const sourceMaskFile = files.find(f => f.fieldname === 'source_mask_0');
        const referenceMaskFile = files.find(f => f.fieldname === 'reference_mask_0');

        if (!sourceMaskFile) throw badRequest("Missing required file: source_mask_0");
        if (!referenceMaskFile) throw badRequest("Missing required file: reference_mask_0");
            
        // 2. === Image Preparation ===
        console.log("Normalizing images to PNG...");
        const [sourcePng, referencePng, sourceMaskPng, referenceMaskPng] = await Promise.all([
            toPng(sourceImageFile.buffer),
            toPng(referenceImageFile.buffer),
            toPng(sourceMaskFile.buffer),
            toPng(referenceMaskFile.buffer),
        ]);

        const sourceMeta = await sharp(sourcePng).metadata();
        const { width, height } = sourceMeta;
        if (!width || !height) {
            throw badRequest("Could not determine source image dimensions.");
        }
        console.log(`Source dimensions: ${width}x${height}`);

        // 3. === AI Processing ===
        const prompt = `You are an expert AI image editor. Your task is to correct a distorted region in a source image using a provided clean reference design.

        You are provided with four images in this order:
        1.  **Source Image:** The original image with a distorted area.
        2.  **Reference Image:** An image containing the clean, correct version of the design.
        3.  **Source Mask:** A mask indicating the distorted region on the "Source Image" that needs to be replaced.
        4.  **Reference Mask:** A mask indicating the clean design on the "Reference Image" to be used for the correction.

        Your goal is to take the content from the "Reference Image" (as indicated by the "Reference Mask") and apply it to the "Source Image" (in the area indicated by the "Source Mask").

        Key requirements:
        - The correction must be seamless. Match the lighting, shadows, texture, and perspective of the original "Source Image".
        - The final output image MUST have the exact same dimensions as the original "Source Image" (${width}x${height} pixels).
        - Do not change anything outside the masked area.
        - Return ONLY the final, full-size, edited image. Do not return any text.`;

        const parts = [
            { text: prompt },
            { inlineData: { mimeType: 'image/png', data: sourcePng.toString('base64') } },
            { inlineData: { mimeType: 'image/png', data: referencePng.toString('base64') } },
            { inlineData: { mimeType: 'image/png', data: sourceMaskPng.toString('base64') } },
            { inlineData: { mimeType: 'image/png', data: referenceMaskPng.toString('base64') } },
        ];

        console.log(`Calling model ${MODEL_ID}...`);
        const response = await ai.models.generateContent({
            model: MODEL_ID,
            contents: { parts },
            config: {
                responseModalities: [Modality.IMAGE, Modality.TEXT],
            },
        });
        console.log("Model response received.");

        // 4. === Response Handling ===
        if (response.promptFeedback?.blockReason) {
            const { blockReason, blockReasonMessage } = response.promptFeedback;
            throw new Error(`Request was blocked by API. Reason: ${blockReason}. ${blockReasonMessage || ''}`);
        }

        const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (!imagePart?.inlineData?.data) {
            const finishReason = response.candidates?.[0]?.finishReason;
            const textFeedback = response.text?.trim();
            console.error("AI response did not contain an image.", { finishReason, textFeedback, response });
            throw new Error(`Processing failed: AI did not return an image. Reason: ${finishReason || 'Unknown'}. ${textFeedback ? `Details: ${textFeedback}` : ''}`);
        }

        const finalImageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
        
        res.setHeader('Content-Type', 'image/png');
        console.log(`OK: sending PNG ${width}x${height}.`);
        res.send(finalImageBuffer);

    } catch (err) {
        next(err); // Forward to global error handler
    }
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
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[worker] listening on ${PORT}`);
});
