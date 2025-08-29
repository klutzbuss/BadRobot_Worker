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
  sourceMasks,       // Array<File|Blob> – masks drawn on distorted image
  referenceMasks,    // Array<File|Blob> – masks drawn on reference image
  signal,
}: {
  workerUrl: string;
  distortedFile: File | Blob;
  referenceFile: File | Blob;
  sourceMasks: Array<File | Blob>;
  referenceMasks: Array<File | Blob>;
  signal?: AbortSignal;
}) {
  const form = new FormData();

  // EXACT FIELD NAMES THE WORKER EXPECTS:
  form.append('source_image', distortedFile, 'source.png');
  form.append('reference_image', referenceFile, 'reference.png');

  // Append masks using the required indexed names
  sourceMasks.forEach((m, i) => {
    form.append(`source_mask_${i}`, m, `source_mask_${i}.png`);
  });
  referenceMasks.forEach((m, i) => {
    form.append(`reference_mask_${i}`, m, `reference_mask_${i}.png`);
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
    const text = await res.text().catch(() => '');
    throw new Error(`Worker ${res.status}: ${text || res.statusText}`);
  }

  // The worker currently returns an image buffer (PNG).
  return await res.blob();
}