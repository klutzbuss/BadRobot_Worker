/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import express from "express";
import multer from "multer";
import cors from "cors";
import sharp from "sharp";
import Jimp from "jimp";

const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// util: get bbox (x,y,w,h) of opaque pixels (mask: white = selected)
async function maskBBox(maskImg) {
  const { width, height, data } = maskImg.bitmap; // RGBA
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      // consider pixel selected if any channel is bright (mask may be white)
      const v = Math.max(data[idx], data[idx + 1], data[idx + 2]);
      if (v > 128) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// util: feather mask (gaussian blur)
async function featherMask(mask, radius = 6) {
  const png = await mask.getBufferAsync(Jimp.MIME_PNG);
  const blurred = await Jimp.read(png);
  blurred.gaussian(radius);
  return blurred;
}

// Error helpers
function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}
function unsupported(message) {
    const err = new Error(message);
    err.status = 415;
    return err;
}

// Allowed MIME types
const okTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

// Normalize any image buffer to a PNG buffer
function toPNG(buffer) {
  return sharp(buffer).png().toBuffer();
}

const allowedField = /^(metadata|source_image|reference_image|source_mask_\d+|reference_mask_\d+)$/;

function getOne(files, name) {
  return files.find(f => f.fieldname === name);
}

function listMaskArray(files, prefix) {
  const list = files
    .filter(f => f.fieldname.startsWith(prefix))
    .sort((a, b) => {
      const ai = parseInt(a.fieldname.split("_").pop() || "0", 10);
      const bi = parseInt(b.fieldname.split("_").pop() || "0", 10);
      return ai - bi;
    });
  return list;
}

app.get("/", (_req, res) => res.send("BadRobot worker is running. Use POST /process to submit a job."));

app.post("/process", upload.any(), async (req, res, next) => {
  try {
    console.log("---- /process request ----");
    
    const files = req.files || [];
    console.log("Metadata field:", req.files.find(f => f.fieldname === "metadata"));

    // Validate that all uploaded field names are allowed
    for (const f of files) {
      if (!allowedField.test(f.fieldname)) {
        // Map Multer’s vague error to a clear 400
        return next(badRequest(`Unexpected field: ${f.fieldname}`));
      }
    }

    // Ensure the two main images exist
    const sourceFile = getOne(files, "source_image");
    const refFile = getOne(files, "reference_image");
    if (!sourceFile || !refFile) {
      return next(badRequest("Missing file(s): require source_image and reference_image"));
    }

    // Validate MIME types
    if (!okTypes.has(sourceFile.mimetype)) {
      return next(unsupported(`Unsupported file type for source_image: ${sourceFile.mimetype}`));
    }
    if (!okTypes.has(refFile.mimetype)) {
      return next(unsupported(`Unsupported file type for reference_image: ${refFile.mimetype}`));
    }

    // Collect masks
    const sourceMasks = listMaskArray(files, "source_mask_");
    const refMasks = listMaskArray(files, "reference_mask_");

    if (sourceMasks.length === 0 || refMasks.length === 0) {
      return next(badRequest("No masks found. Please paint at least one source_mask_# and reference_mask_#."));
    }
    if (sourceMasks.length !== refMasks.length) {
      return next(badRequest(`Mask count mismatch. source=${sourceMasks.length} reference=${refMasks.length}`));
    }
    
    console.log(`Processing ${sourceMasks.length} mask pair(s).`);

    // Normalize to PNG buffers
    const sourcePNG = await toPNG(sourceFile.buffer);
    const refPNG = await toPNG(refFile.buffer);

    const pairs = [];
    for (let i = 0; i < sourceMasks.length; i++) {
        const sMask = sourceMasks[i];
        const rMask = refMasks[i];

        if (!okTypes.has(sMask.mimetype)) {
            return next(unsupported(`source_mask_${i} type: ${sMask.mimetype}`));
        }
        if (!okTypes.has(rMask.mimetype)) {
            return next(unsupported(`reference_mask_${i} type: ${rMask.mimetype}`));
        }

        const sMaskPNG = await toPNG(sMask.buffer);
        const rMaskPNG = await toPNG(rMask.buffer);

        pairs.push({ index: i, sourceMaskPNG: sMaskPNG, referenceMaskPNG: rMaskPNG });
    }

    // Initialize working canvas from the source image
    const workingCanvas = await Jimp.read(sourcePNG);
    const W = workingCanvas.bitmap.width;
    const H = workingCanvas.bitmap.height;
    
    // Load and resize reference image once
    const refImg = await Jimp.read(refPNG);
    refImg.resize(W, H, Jimp.RESIZE_BILINEAR);
    
    // Sequentially process each mask pair
    for (const pair of pairs) {
        console.log(`Processing mask pair ${pair.index}`);

        // Load masks from buffers
        let maskA = await Jimp.read(pair.sourceMaskPNG);
        let maskB = await Jimp.read(pair.referenceMaskPNG);
        
        // Resize masks to working canvas size
        maskA.resize(W, H, Jimp.RESIZE_BILINEAR);
        maskB.resize(W, H, Jimp.RESIZE_BILINEAR);

        // Compute bboxes
        const bbA = await maskBBox(maskA);
        const bbB = await maskBBox(maskB);
        
        if (!bbA || !bbB) {
            console.warn(`Skipping pair ${pair.index} due to empty mask.`);
            continue; // Skip this pair if a mask is empty
        }

        // 1) Crop reference to its bbox (Mask B)
        const refCrop = refImg.clone().crop(bbB.x, bbB.y, bbB.w, bbB.h);
    
        // 2) Resize that crop to the source bbox (Mask A)
        refCrop.resize(bbA.w, bbA.h, Jimp.RESIZE_BICUBIC);
    
        // 3) Build a patch canvas at base size, place resized crop into A's bbox
        const refPatch = new Jimp(W, H, 0x00000000);
        refPatch.composite(refCrop, bbA.x, bbA.y);
    
        // 4) Feather Mask A, then apply as alpha to the patch
        const featheredA = await featherMask(maskA, 4);
        refPatch.mask(featheredA, 0, 0);
    
        // 5) Composite patch over the *working canvas*
        workingCanvas.composite(refPatch, 0, 0);
    }

    const png = await workingCanvas.getBufferAsync(Jimp.MIME_PNG);
    res.set("Content-Type", "image/png");
    console.log(`OK: sending PNG ${W}x${H} after processing ${pairs.length} mask pair(s).`);
    res.send(png);

  } catch (err) {
    // Forward error to global handler
    next(err);
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// Multer error mapping
app.use((err, _req, res, next) => {
  // If this is Multer’s unexpected field error, turn it into 400
  if (err && err.code === "LIMIT_UNEXPECTED_FILE") {
    err.status = 400;
    err.message = `Unexpected field: ${err.field}`;
  }
  next(err);
});

// Global error handler
app.use((err, _req, res, _next) => {
    console.error("Worker error:", err);
    const status = err.status || 500;
    const message = err.message || "Processing failed";
    res.status(status).json({ error: message, details: String(err) });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Worker listening on :${PORT}`));