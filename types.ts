/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CorrectionPair {
  colorId: string;
  method: 'extract' | 'generate';
  sourceBBox: BBox | null;
  referenceBBox: BBox | null;
}

export interface WorkerMetadata {
  width: number;
  height: number;
  enforceFixedCanvas: boolean;
  sequential: boolean;
  pairs: CorrectionPair[];
}
