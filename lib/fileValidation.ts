/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export function validateImageFile(file: File): { valid: boolean; error?: string } {
  const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: "Unsupported file type. Please insert a PNG, JPEG, JPG, or WEBP file."
    };
  }
  return { valid: true };
}
