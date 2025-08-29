/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export async function toPngBlob(input: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(input);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not available");
  ctx.drawImage(bitmap, 0, 0);
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b as Blob), "image/png")
  );
  return blob;
}
