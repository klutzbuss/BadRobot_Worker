/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState } from "react";

export default function ComparisonSlider({ beforeUrl, afterUrl }: {beforeUrl:string; afterUrl:string}) {
  const [pos, setPos] = useState(0.5);
  
  // Use a containing div to ensure the absolute positioning is relative to the slider component itself.
  return (
    <div className="relative w-full h-full">
      <div className="absolute inset-0 overflow-hidden">
        <img src={beforeUrl} alt="Before" className="absolute inset-0 w-full h-full object-contain" />
        <div style={{ position:"absolute", inset:0, clipPath: `inset(0 ${100 - (pos * 100)}% 0 0)` }}>
          <img src={afterUrl} alt="After" className="absolute inset-0 w-full h-full object-contain" />
        </div>
      </div>
      <input
        type="range" min={0} max={1} step={0.01} value={pos}
        onChange={(e)=>setPos(parseFloat(e.target.value))}
        className="absolute bottom-4 left-1/4 w-1/2 h-1 accent-cyan-400"
        style={{ zIndex: 10 }}
      />
    </div>
  );
}
