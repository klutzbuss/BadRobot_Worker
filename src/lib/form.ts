/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export interface MaskPair {
  colorName: string;               // e.g. "red"
  sourceMask: string | Blob;       // data URL "data:image/png;base64,..." or Blob
  referenceMask: string | Blob;    // data URL or Blob
}

export async function submitCorrection(opts: {
  workerUrl: string;
  distortedFile: File;
  referenceFile: File;
  maskPairs: MaskPair[];
}): Promise<Blob> {
  const { workerUrl, distortedFile, referenceFile, maskPairs } = opts;

  if (!workerUrl) throw new Error("Missing workerUrl");
  if (!distortedFile) throw new Error("Missing distortedFile");
  if (!referenceFile) throw new Error("Missing referenceFile");
  if (!maskPairs?.length) throw new Error("No mask pairs provided");

  // Helper: convert data URL to Blob
  const dataUrlToBlob = async (input: string | Blob): Promise<Blob> => {
    if (input instanceof Blob) return input;
    if (!/^data:image\/png;base64,/.test(input)) {
      throw new Error("Mask must be a PNG data URL");
    }
    const base64 = input.split(",")[1] ?? "";
    const bin = atob(base64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: "image/png" });
  };

  const form = new FormData();
  form.append("source_image", distortedFile);
  form.append("reference_image", referenceFile);
  form.append("pairs", String(maskPairs.length));

  // Append masks with deterministic names: source_mask_0 / reference_mask_0 ...
  for (let i = 0; i < maskPairs.length; i++) {
    const p = maskPairs[i];
    const srcBlob = await dataUrlToBlob(p.sourceMask);
    const refBlob = await dataUrlToBlob(p.referenceMask);
    form.append(`source_mask_${i}`, srcBlob, `source_mask_${i}.png`);
    form.append(`reference_mask_${i}`, refBlob, `reference_mask_${i}.png`);
  }

  // POST
  const resp = await fetch(`${workerUrl.replace(/\/+$/, "")}/process`, {
    method: "POST",
    body: form,
  });

  // If backend returns a JSON error payload, surface the details
  if (!resp.ok) {
    let msg = `Worker ${resp.status}`;
    try {
      const t = await resp.text();
      // Try to parse JSON but keep raw text if not JSON
      msg += `: ${t || "Unknown error"}`;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  // Expect an image (PNG/JPEG) back
  const blob = await resp.blob();
  if (!/^image\//.test(blob.type || "")) {
    // If server replies JSON by mistake, return readable text
    try {
      const txt = await blob.text();
      throw new Error(`Worker returned non-image response: ${txt}`);
    } catch {
      throw new Error("Worker returned non-image response.");
    }
  }
  return blob;
}
