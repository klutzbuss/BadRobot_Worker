/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

// Make Tesseract available in the global scope from the CDN script
declare const Tesseract: any;

interface ClassificationResult {
  route: 'copy_exact' | 'style_match';
  confidence: number;
}

// Helper to load a base64 image into a canvas
const loadImageToCanvas = (base64: string): Promise<HTMLCanvasElement> => {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(image, 0, 0);
                resolve(canvas);
            } else {
                reject(new Error("Could not get canvas context"));
            }
        };
        image.onerror = reject;
        image.src = base64;
    });
};

// Heuristics for classifying a patch
export const classifyPatch = async (patchBase64: string): Promise<ClassificationResult> => {
    // 1. OCR Check with Tesseract.js
    try {
        const result = await Tesseract.recognize(patchBase64, 'eng');
        const text = result.data.text.trim();
        const confidentWords = result.data.words.filter((w: any) => w.confidence > 60);
        
        if (text.length >= 3 && confidentWords.length > 0) {
            const avgConfidence = confidentWords.reduce((acc: number, w: any) => acc + w.confidence, 0) / confidentWords.length;
            if (avgConfidence > 60) {
                 return { route: 'copy_exact', confidence: avgConfidence / 100 };
            }
        }
    } catch (err) {
        console.warn("Tesseract OCR failed:", err);
    }
    
    // 2. Vector-ish score (simplified client-side version)
    try {
        const canvas = await loadImageToCanvas(patchBase64);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return { route: 'style_match', confidence: 0.5 };
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const uniqueColors = new Set<string>();
        let nonTransparentPixels = 0;

        for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha > 20) { // Consider pixel visible
                nonTransparentPixels++;
                uniqueColors.add(`${data[i]},${data[i+1]},${data[i+2]}`);
            }
        }
        
        // If it's mostly empty, default to generate
        if (nonTransparentPixels < 50) {
             return { route: 'style_match', confidence: 0.6 };
        }

        // Low color count is a strong indicator of vector/logo
        if (uniqueColors.size > 1 && uniqueColors.size <= 32) {
            return { route: 'copy_exact', confidence: 0.85 };
        }
        if (uniqueColors.size > 1 && uniqueColors.size <= 128) {
            return { route: 'copy_exact', confidence: 0.6 };
        }

    } catch(err) {
        console.warn("Canvas analysis for patch classification failed:", err);
    }
    
    // Default fallback
    return { route: 'style_match', confidence: 0.5 };
};
