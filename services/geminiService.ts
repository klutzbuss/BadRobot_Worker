/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";

// Helper to convert a File object to a Gemini API Part
const fileToPart = async (file: File): Promise<{ inlineData: { mimeType: string; data: string; } }> => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });
    
    return dataUrlToPart(dataUrl);
};

const dataUrlToPart = (dataUrl: string): { inlineData: { mimeType: string; data: string; } } => {
    const arr = dataUrl.split(',');
    if (arr.length < 2) throw new Error("Invalid data URL");
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch || !mimeMatch[1]) throw new Error("Could not parse MIME type from data URL");
    
    const mimeType = mimeMatch[1];
    const data = arr[1];
    return { inlineData: { mimeType, data } };
}

const handleApiResponse = (
    response: GenerateContentResponse,
    context: string // e.g., "edit", "filter", "adjustment"
): string => {
    // 1. Check for prompt blocking first
    if (response.promptFeedback?.blockReason) {
        const { blockReason, blockReasonMessage } = response.promptFeedback;
        const errorMessage = `Request was blocked. Reason: ${blockReason}. ${blockReasonMessage || ''}`;
        console.error(errorMessage, { response });
        throw new Error(errorMessage);
    }

    // 2. Try to find the image part
    const imagePartFromResponse = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);

    if (imagePartFromResponse?.inlineData) {
        const { mimeType, data } = imagePartFromResponse.inlineData;
        console.log(`Received image data (${mimeType}) for ${context}`);
        return `data:${mimeType};base64,${data}`;
    }

    // 3. If no image, check for other reasons
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
        const errorMessage = `Image generation for ${context} stopped unexpectedly. Reason: ${finishReason}. This often relates to safety settings.`;
        console.error(errorMessage, { response });
        throw new Error(errorMessage);
    }
    
    const textFeedback = response.text?.trim();
    const errorMessage = `The AI model did not return an image for the ${context}. ` + 
        (textFeedback 
            ? `The model responded with text: "${textFeedback}"`
            : "This can happen due to safety filters or if the request is too complex. Please try rephrasing your prompt to be more direct.");

    console.error(`Model response did not contain an image part for ${context}.`, { response });
    throw new Error(errorMessage);
};

/**
 * Generates a product mockup by placing a design onto a base image.
 * @param baseImage The base image file (e.g., a t-shirt).
 * @param productImage The product design file (e.g., a logo).
 * @param userPrompt The text prompt describing how to apply the design.
 * @returns A promise that resolves to the data URL of the final image.
 */
export const generateProductImage = async (
    baseImage: File,
    productImage: File,
    userPrompt: string
): Promise<string> => {
    console.log('Starting product image generation.');
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    
    const baseImagePart = await fileToPart(baseImage);
    // FIX: Fix typo from `fileTopart` to `fileToPart` to correctly call the helper function.
    const productImagePart = await fileToPart(productImage);

    const prompt = `You are an expert at creating photorealistic product mockups. Your task is to place the provided 'PRODUCT DESIGN' onto the 'BASE IMAGE'.
User instructions for placement and style: "${userPrompt}"

Key requirements:
1.  The final image MUST be the same resolution and crop as the original 'BASE IMAGE'.
2.  The 'PRODUCT DESIGN' must be seamlessly and realistically integrated.
3.  You MUST respect the lighting, shadows, contours, and texture of the 'BASE IMAGE'. For example, if placing a design on a t-shirt, it must follow the wrinkles and fabric texture.

Output: Return ONLY the final, edited image. Do not return any text.`;
    
    const parts = [
        { text: prompt },
        { text: "\n--- BASE IMAGE ---" },
        baseImagePart,
        { text: "\n--- PRODUCT DESIGN ---" },
        productImagePart
    ];

    console.log('Sending images and prompt to the model...');
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    console.log('Received response from model.', response);

    return handleApiResponse(response, 'product mockup');
};

/**
 * Corrects a distorted image patch based on a clean reference patch using AI.
 * @param distortedPatchUrl A data URL of the distorted content on a transparent background.
 * @param referencePatchUrl A data URL of the clean reference content on a transparent background.
 * @param mode The correction method to use ('auto', 'extract', or 'generate').
 * @returns A promise that resolves to the data URL of the corrected patch on a transparent background.
 */
export const generateCorrectedImage = async (
    distortedPatchUrl: string,
    referencePatchUrl: string,
    mode: 'auto' | 'extract' | 'generate'
): Promise<string> => {
    console.log(`Starting patch correction generation with mode: ${mode}.`);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

    const distortedPatchPart = dataUrlToPart(distortedPatchUrl);
    const referencePatchPart = dataUrlToPart(referencePatchUrl);

    let modeInstruction = '';
    switch (mode) {
        case 'extract':
            modeInstruction = "You must warp the 'REFERENCE PATCH' to perfectly match the shape and perspective of the 'DISTORTED PATCH'. This is for text, logos, or sharp vector-like features. Preserve all details from the reference.";
            break;
        case 'generate':
            modeInstruction = "You must regenerate the content from scratch, using the 'REFERENCE PATCH' as a style guide. The final output must match the lighting, texture, and shape of the 'DISTORTED PATCH'. This is for textures or photographic areas.";
            break;
        case 'auto':
        default:
            modeInstruction = "Analyze the content. If it's text/logo, behave like 'Extract Mode'. If it's a texture/photo, behave like 'Generate Mode'.";
            break;
    }

    const prompt = `You are a surgical AI image correction tool. Your task is to correct a distorted image patch based on a clean reference patch.

**INPUTS:**
1.  **DISTORTED PATCH:** A PNG image containing the distorted content on a transparent background. This provides the target shape, lighting, and texture.
2.  **REFERENCE PATCH:** A PNG image containing the clean design source on a transparent background.

**CORE DIRECTIVE:**
- Your output MUST be a single PNG image on a transparent background.
- This output PNG must contain the corrected content.
- The corrected content MUST have the exact same dimensions, shape, and transparency as the original 'DISTORTED PATCH'.
- You must blend the 'REFERENCE PATCH' design to match the lighting and texture of the 'DISTORTED PATCH'.
- DO NOT change the resolution. DO NOT crop the image.

**METHOD:**
${modeInstruction}

**OUTPUT:**
Return ONLY the final, corrected patch as a PNG image with a transparent background. Do not return any text.`;

    const parts = [
        { text: prompt },
        { text: "\n--- DISTORTED PATCH (Image 1 - The target shape and lighting) ---" },
        distortedPatchPart,
        { text: "\n--- REFERENCE PATCH (Image 2 - The clean design source) ---" },
        referencePatchPart,
    ];

    console.log('Sending patch correction request to the model...');
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    console.log('Received response from model for patch correction.', response);

    return handleApiResponse(response, 'correction patch');
};
