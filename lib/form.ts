/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

/**
 * A single place to build the payload exactly as the worker expects and
 * submit it for processing.
 * @returns A promise that resolves to the processed image blob.
 */
export async function submitCorrection({
  workerUrl,
  distortedFile,     // File|Blob – the distorted/source image
  referenceFile,     // File|Blob – the clean/reference image
  maskPairs,         // Array of { colorName, sourceMask, referenceMask }
  signal,
}: {
  workerUrl: string;
  distortedFile: File | Blob;
  referenceFile: File | Blob;
  maskPairs: Array<{ colorName: string, sourceMask: Blob, referenceMask: Blob }>;
  signal?: AbortSignal;
}) {
  const form = new FormData();

  // EXACT FIELD NAMES THE WORKER EXPECTS:
  form.append('source_image', distortedFile, 'source.png');
  form.append('reference_image', referenceFile, 'reference.png');

  // Append masks using the required color-coded names
  maskPairs.forEach(pair => {
    form.append(`source_mask_${pair.colorName}`, pair.sourceMask, `source_mask_${pair.colorName}.png`);
    form.append(`reference_mask_${pair.colorName}`, pair.referenceMask, `reference_mask_${pair.colorName}.png`);
  });

  // Debug: log what we are sending
  console.log(
    'Uploading fields:',
    [...form.entries()].map(([k, v]) => [k, (v as File).name ?? v])
  );

  const url = `${workerUrl.replace(/\/$/, "")}/process`;
  const res = await fetch(url, {
    method: 'POST',
    body: form,
    signal,
  });

  if (!res.ok) {
    try {
        const errJson = await res.json();
        throw new Error(`Worker ${res.status}: ${errJson.detail || errJson.error || res.statusText}`);
    } catch(e) {
        // Fallback if the response is not JSON
        const text = await res.text().catch(() => '');
        throw new Error(`Worker ${res.status}: ${text || res.statusText}`);
    }
  }

  // The worker returns an image buffer (PNG).
  return await res.blob();
}