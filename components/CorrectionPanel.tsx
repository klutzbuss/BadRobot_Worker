/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef, useMemo } from 'react';
import PaintCanvas, { CanvasRef } from './PaintCanvas';
import Spinner from './Spinner';
import { UploadIcon, PlusIcon, TrashIcon, CheckIcon, QuestionMarkCircleIcon } from './icons';
import { validateImageFile } from '../lib/fileValidation';
import { submitCorrection } from '../lib/form';
import { WORKER_URL } from '../config/runtime';
import { classifyPatch } from '../utils/classifyPatch';

type CorrectionMode = 'auto' | 'extract' | 'generate';

export interface CorrectionHistoryState {
    canUndo: boolean;
    canRedo: boolean;
}

// Helper to load an image from a URL
const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = src;
    });
};

const CORRECTION_COLORS = [
  { name: 'red', hex: '#ef4444' },
  { name: 'green', hex: '#22c55e' },
  { name: 'blue', hex: '#3b82f6' },
  { name: 'yellow', hex: '#eab308' },
  { name: 'cyan', hex: '#22d3ee' },
];

interface CorrectionPanelProps {
  sourceImage: File;
  sourceImageUrl: string;
  onCorrectionReady: (url: string) => void;
  onError: (error: string) => void;
  onHistoryUpdate: (state: CorrectionHistoryState) => void;
  onReferenceImageUpload: (hasReference: boolean) => void;
  onReplaceSourceImage: (file: File) => void;
}

export interface CorrectionPanelRef {
    reset: () => void;
    undo: () => void;
    redo: () => void;
}

const CorrectionPanel = forwardRef<CorrectionPanelRef, CorrectionPanelProps>(({ sourceImage, sourceImageUrl, onCorrectionReady, onError, onHistoryUpdate, onReferenceImageUpload, onReplaceSourceImage }, ref) => {
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [colors] = useState(CORRECTION_COLORS);
  const [activeColor, setActiveColor] = useState(CORRECTION_COLORS[0].hex);
  
  const [correctionModes, setCorrectionModes] = useState<Map<string, CorrectionMode>>(new Map());
  const [sourceActiveColors, setSourceActiveColors] = useState<Set<string>>(new Set());
  const [refActiveColors, setRefActiveColors] = useState<Set<string>>(new Set());

  const [isLoading, setIsLoading] = useState(false);
  const [brushSize, setBrushSize] = useState(30);
  const [lastPaintedCanvas, setLastPaintedCanvas] = useState<'source' | 'ref' | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [outputSizeStatus, setOutputSizeStatus] = useState<{w: number, h: number, ok: boolean} | null>(null);

  const brushSliderRef = useRef<HTMLInputElement>(null);
  const sourceCanvasRef = useRef<CanvasRef>(null);
  const refCanvasRef = useRef<CanvasRef>(null);

  const updateParentHistory = useCallback(() => {
    const sourceHistory = sourceCanvasRef.current?.getHistoryState() ?? { canUndo: false, canRedo: false };
    const refHistory = refCanvasRef.current?.getHistoryState() ?? { canUndo: false, canRedo: false };
    onHistoryUpdate({
      canUndo: sourceHistory.canUndo || refHistory.canUndo,
      canRedo: sourceHistory.canRedo || refHistory.canRedo,
    });
  }, [onHistoryUpdate]);
  
  // Update slider thumb size
  useEffect(() => {
    if (brushSliderRef.current) {
        const minSize = 12;
        const maxSize = 32;
        const minVal = 5;
        const maxVal = 100;
        const newSize = minSize + ((brushSize - minVal) / (maxVal - minVal)) * (maxSize - minSize);
        brushSliderRef.current.style.setProperty('--thumb-size', `${newSize}px`);
    }
  }, [brushSize]);

  useImperativeHandle(ref, () => ({
    reset: () => {
        sourceCanvasRef.current?.clearCanvas();
        refCanvasRef.current?.clearCanvas();
        setOutputSizeStatus(null);
    },
    undo: () => {
        const sourceHistory = sourceCanvasRef.current?.getHistoryState();
        const refHistory = refCanvasRef.current?.getHistoryState();

        if (lastPaintedCanvas === 'source' && sourceHistory?.canUndo) {
             sourceCanvasRef.current?.undo();
        } else if (lastPaintedCanvas === 'ref' && refHistory?.canUndo) {
             refCanvasRef.current?.undo();
        } else if (sourceHistory?.canUndo) {
            sourceCanvasRef.current?.undo();
        } else if (refHistory?.canUndo) {
            refCanvasRef.current?.undo();
        }
    },
    redo: () => {
        const sourceHistory = sourceCanvasRef.current?.getHistoryState();
        const refHistory = refCanvasRef.current?.getHistoryState();

        if (lastPaintedCanvas === 'source' && sourceHistory?.canRedo) {
             sourceCanvasRef.current?.redo();
        } else if (lastPaintedCanvas === 'ref' && refHistory?.canRedo) {
             refCanvasRef.current?.redo();
        } else if (sourceHistory?.canRedo) {
            sourceCanvasRef.current?.redo();
        } else if (refHistory?.canRedo) {
            refCanvasRef.current?.redo();
        }
    }
  }));

  useEffect(() => {
    if (referenceImage) {
      const url = URL.createObjectURL(referenceImage);
      setReferenceImageUrl(url);
      onReferenceImageUpload(true);
      return () => {
        URL.revokeObjectURL(url);
        onReferenceImageUpload(false);
      }
    } else {
        setReferenceImageUrl(null);
        onReferenceImageUpload(false);
    }
  }, [referenceImage, onReferenceImageUpload]);
  
  const handleFileSelect = (file: File | null) => {
    if (file) {
      const { valid, error } = validateImageFile(file);
      if (!valid) {
        onError(error || "Unsupported file type. Please insert a PNG, JPEG, JPG, or WEBP file.");
        return;
      }
      setReferenceImage(file);
      onError('');
    }
  };
  
  const handleSourceFileSelect = (file: File | null) => {
    if (file) {
      const { valid, error } = validateImageFile(file);
      if (!valid) {
        onError(error || "Unsupported file type. Please insert a PNG, JPEG, JPG, or WEBP file.");
        return;
      }
      onReplaceSourceImage(file);
    }
  };

  const handleModeChange = (color: string, mode: CorrectionMode) => {
    setCorrectionModes(prev => new Map(prev).set(color, mode));
  };
  
  const pairedColors = useMemo(() => {
    return [...sourceActiveColors].filter(c => refActiveColors.has(c));
  }, [sourceActiveColors, refActiveColors]);

  const activeCorrectionTasks = useMemo(() => {
    return pairedColors.map(colorHex => {
      const colorInfo = colors.find(c => c.hex === colorHex);
      return {
        hex: colorHex,
        name: colorInfo?.name || colorHex,
        mode: correctionModes.get(colorHex) || 'auto',
      }
    });
  }, [pairedColors, colors, correctionModes]);

  const handleGenerate = async () => {
    if (!referenceImage || !referenceImageUrl || !sourceCanvasRef.current || !refCanvasRef.current) {
        onError("Please upload a reference image.");
        return;
    }
    
    setIsLoading(true);
    onError("");
    setOutputSizeStatus(null);
    
    try {
        const { width: W, height: H } = sourceCanvasRef.current.getNaturalSize();
        if (!W || !H) {
            throw new Error("Could not determine source image dimensions.");
        }

        const validPairedColors = pairedColors;
        if (validPairedColors.length === 0) {
            throw new Error("Please paint on both the source and reference images with the same color to link correction areas.");
        }
        
        console.log(`[BadRobot] Preparing ${validPairedColors.length} correction pair(s).`);

        const maskPairs = [];

        for (const colorHex of validPairedColors) {
            const sourceMask = await sourceCanvasRef.current.getMaskPNG(colorHex);
            const refMask = await refCanvasRef.current.getMaskPNG(colorHex);

            if (!sourceMask || !refMask) {
                console.warn(`Skipping incomplete mask pair for color ${colorHex}`);
                continue;
            }
            
            const colorName = colors.find(c => c.hex === colorHex)?.name;
            if (!colorName) {
                console.warn(`Skipping mask for unknown color hex ${colorHex}`);
                continue;
            }

            maskPairs.push({
                colorName: colorName,
                sourceMask: sourceMask,
                referenceMask: refMask,
            });
        }
        
        if (maskPairs.length === 0) {
            throw new Error("No valid, complete mask pairs were generated. Ensure you paint on both images with the same color.");
        }

        console.log(`[BadRobot] Submitting correction with ${maskPairs.length} pairs.`);

        // 2. Call the worker via the new helper
        const resultBlob = await submitCorrection({
            workerUrl: WORKER_URL,
            distortedFile: sourceImage,
            referenceFile: referenceImage,
            maskPairs: maskPairs,
        });

        // 3. Process the returned image
        const correctedUrl = URL.createObjectURL(resultBlob);
        
        const resultImg = await loadImage(correctedUrl);
        const ok = resultImg.naturalWidth === W && resultImg.naturalHeight === H;
        setOutputSizeStatus({ w: resultImg.naturalWidth, h: resultImg.naturalHeight, ok });
        
        if (!ok) {
            URL.revokeObjectURL(correctedUrl); // Clean up
            throw new Error(`Dimension mismatch: Expected ${W}x${H}, but received ${resultImg.naturalWidth}x${resultImg.naturalHeight}.`);
        }
        
        onCorrectionReady(correctedUrl);

    } catch (err) {
        const msg = err instanceof Error ? err.message : "An unknown error occurred during correction.";
        onError(msg);
    } finally {
        setIsLoading(false);
    }
  };
  
  return (
    <div className="w-full flex flex-col items-center gap-4 animate-fade-in relative">
      {isLoading && (
          <div className="absolute inset-0 bg-black/80 z-30 flex flex-col items-center justify-center gap-4 animate-fade-in rounded-lg backdrop-blur-sm">
              <Spinner />
              <p className="text-gray-300">Applying AI corrections...</p>
          </div>
      )}
      {!referenceImageUrl ? (
        <div 
          className={`w-full flex flex-col items-center justify-center gap-4 h-96 bg-gray-800/50 rounded-lg transition-all duration-200 border-2 ${isDraggingOver ? 'border-dashed border-blue-400 bg-blue-500/10' : 'border-dashed border-gray-600'}`}
          onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOver(false);
            handleFileSelect(e.dataTransfer.files?.[0] || null);
          }}
        >
            <h2 className="text-2xl font-bold text-gray-300">Upload Reference Design</h2>
            <p className="text-gray-400">Upload the clean, high-quality design to use for corrections.</p>
            <label htmlFor="ref-upload" className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-6 rounded-lg cursor-pointer flex items-center gap-2">
                <UploadIcon className="w-5 h-5" />
                Upload Reference
            </label>
            <input type="file" id="ref-upload" className="hidden" onChange={(e) => handleFileSelect(e.target.files?.[0] || null)} accept="image/*" />
            <p className="text-sm text-gray-500">or drag and drop a file</p>
        </div>
      ) : (
        <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                <div className="flex flex-col items-center gap-2">
                    <h3 className="text-lg font-semibold">Distorted Image (Source)</h3>
                    <div className="w-full aspect-square bg-black/20 rounded-lg overflow-hidden border border-gray-700 relative group">
                        <PaintCanvas ref={sourceCanvasRef} imageUrl={sourceImageUrl} color={activeColor} brushSize={brushSize} onPaintStart={() => setLastPaintedCanvas('source')} onHistoryUpdate={updateParentHistory} onActiveColorsChange={setSourceActiveColors} onError={onError} />
                        <label htmlFor="source-replace-upload" title="Upload new image" className="absolute top-2 right-2 p-2 bg-black/50 rounded-full cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm hover:bg-black/75">
                            <UploadIcon className="w-5 h-5 text-white" />
                        </label>
                        <input type="file" id="source-replace-upload" className="hidden" onChange={(e) => handleSourceFileSelect(e.target.files?.[0] || null)} accept="image/*" />
                    </div>
                </div>
                <div className="flex flex-col items-center gap-2">
                    <h3 className="text-lg font-semibold">Clean Design (Reference)</h3>
                    <div className="w-full aspect-square bg-black/20 rounded-lg overflow-hidden border border-gray-700 relative group">
                        <PaintCanvas ref={refCanvasRef} imageUrl={referenceImageUrl} color={activeColor} brushSize={brushSize} onPaintStart={() => setLastPaintedCanvas('ref')} onHistoryUpdate={updateParentHistory} onActiveColorsChange={setRefActiveColors} onError={onError} />
                        <label htmlFor="ref-replace-upload" title="Upload new image" className="absolute top-2 right-2 p-2 bg-black/50 rounded-full cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm hover:bg-black/75">
                            <UploadIcon className="w-5 h-5 text-white" />
                        </label>
                        <input type="file" id="ref-replace-upload" className="hidden" onChange={(e) => handleFileSelect(e.target.files?.[0] || null)} accept="image/*" />
                    </div>
                </div>
            </div>
            <p className="text-sm text-gray-500 -mt-2">
                <b>Tip:</b> Use scroll wheel to zoom. Hold middle mouse button to pan.
            </p>

            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 w-full max-w-4xl flex flex-col gap-4">
                <div className="flex items-center justify-center gap-2 flex-wrap relative">
                    <span className="font-semibold">Paint Color:</span>
                    {colors.map(c => (
                        <div key={c.hex} className="relative group">
                            <button onClick={() => setActiveColor(c.hex)} className={`w-8 h-8 rounded-full border-2 transition-transform ${activeColor === c.hex ? 'border-white scale-110 shadow-lg' : 'border-transparent'}`} style={{backgroundColor: c.hex}} aria-label={`Select ${c.name} color`}></button>
                        </div>
                    ))}
                </div>
                
                <div className="flex items-center gap-4 px-4">
                    <span className="font-semibold text-sm shrink-0">Brush Size:</span>
                    <input 
                        ref={brushSliderRef}
                        type="range" 
                        min="5" 
                        max="100" 
                        value={brushSize} 
                        onChange={(e) => setBrushSize(parseInt(e.target.value))}
                        className="w-full h-2 rounded-lg appearance-none cursor-pointer brush-slider"
                    />
                </div>

                {activeCorrectionTasks.length > 0 && (
                    <div className="border-t border-gray-700 pt-4 flex flex-col gap-3">
                        <h4 className="text-center font-semibold">Linked Correction Tasks</h4>
                        {activeCorrectionTasks.map(task => (
                            <div key={task.hex} className="flex items-center justify-between bg-black/20 p-2 rounded-md">
                                <div className="flex items-center gap-2">
                                    <div className="w-5 h-5 rounded-full" style={{backgroundColor: task.hex}}></div>
                                    <span className="font-semibold capitalize">{task.name}</span>
                                    <CheckIcon className="w-5 h-5 text-green-400 animate-fade-in" title="This correction is linked and ready"/>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="relative group flex items-center gap-1.5">
                                        <label className="text-sm font-medium text-gray-300">Method:</label>
                                        <QuestionMarkCircleIcon className="w-4 h-4 text-gray-400 cursor-help"/>
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-gray-900 border border-gray-600 text-gray-300 text-xs rounded-lg p-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg">
                                            <strong className="block">Auto:</strong> Let the AI decide the best method.
                                            <strong className="block mt-2">Extract:</strong> Warps reference material. Best for text, logos, and sharp vector-like features.
                                            <strong className="block mt-2">Generate:</strong> Regenerates content from scratch using the reference as a style guide. Best for textures, patterns, and photographic areas.
                                            <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-gray-600"></div>
                                        </div>
                                    </div>
                                    <select value={task.mode} onChange={(e) => handleModeChange(task.hex, e.target.value as CorrectionMode)} className="bg-gray-700 border-gray-600 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-1.5">
                                        <option value="auto">Auto</option>
                                        <option value="extract">Extract</option>
                                        <option value="generate">Generate</option>
                                    </select>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                
                <div className="flex items-center justify-center gap-4">
                  <button 
                      onClick={handleGenerate} 
                      disabled={isLoading || pairedColors.length === 0}
                      className="w-full bg-gradient-to-br from-green-600 to-green-500 text-white font-bold py-4 px-6 rounded-lg transition-all duration-300 ease-in-out shadow-lg shadow-green-500/20 hover:shadow-xl hover:shadow-green-500/40 hover:-translate-y-px active:scale-95 active:shadow-inner text-base disabled:from-gray-600 disabled:to-gray-700 disabled:shadow-none disabled:cursor-not-allowed disabled:transform-none"
                  >
                      {isLoading ? 'Generating...' : (pairedColors.length === 0 ? 'Awaiting Correction Link...' : `Generate Correction (${pairedColors.length})`)}
                  </button>
                  {outputSizeStatus && (
                    <div className={`text-xs px-2 py-1 rounded-md ${outputSizeStatus.ok ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                      Output: {outputSizeStatus.w}x{outputSizeStatus.h} {outputSizeStatus.ok ? '✓' : '✗'}
                    </div>
                  )}
                </div>
            </div>
        </>
      )}
    </div>
  );
});

export default CorrectionPanel;