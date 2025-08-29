/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { WORKER_URL } from '../config/runtime';

/**
 * Sends a correction job for processing.
 * It forwards the job to the external worker specified by WORKER_URL.
 *
 * @param formData The multipart/form-data payload for the correction job.
 * @returns A promise that resolves to the processed image blob.
 */
export const processCorrection = async (formData: FormData): Promise<Blob> => {
    const processUrl = `${WORKER_URL}/process`;

    console.log("[BadRobot] Calling worker:", processUrl);

    const response = await fetch(processUrl, {
        method: 'POST',
        body: formData,
    });
    
    console.log("[BadRobot] Worker status:", response.status, response.headers.get("content-type"));
    
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.error("[BadRobot] Worker failed:", response.status, text);
        throw new Error(`Worker failed: ${response.status}`);
    }

    const blob = await response.blob();
    console.log("[BadRobot] Worker blob:", blob.type, blob.size);
    return blob;
};