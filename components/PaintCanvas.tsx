/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef, useEffect, useImperativeHandle, forwardRef, useState, useCallback } from 'react';

// Helper to convert hex color to rgba for transparency
const hexToRgba = (hex: string, alpha: number): string => {
    if (!hex.startsWith('#')) return `rgba(255, 255, 255, ${alpha})`;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

type PathHistoryItem = { color: string; path: Path2D; brushSize: number };

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

interface PaintCanvasProps {
  imageUrl: string;
  color: string;
  brushSize: number;
  onPaintStart: () => void;
  onHistoryUpdate: () => void;
  onActiveColorsChange: (colors: Set<string>) => void;
}

export interface CanvasRef {
  getMaskAsBase64: (color: string) => Promise<string | null>;
  clearCanvas: () => void;
  exportAllMasks: () => Promise<Record<string, string>>;
  undo: () => void;
  redo: () => void;
  deletePathsForColor: (color: string) => void;
  getHistoryState: () => HistoryState;
  extractPatchForColor: (color: string) => Promise<string | null>;
  // New methods for advanced pipeline
  getNaturalSize: () => { width: number, height: number };
  getMaskBBox: (color: string) => { x: number, y: number, w: number, h: number } | null;
  getMaskPNG: (color: string) => Promise<Blob | null>;
  getCombinedMaskPNG: (colors: string[]) => Promise<Blob | null>;
}

const PaintCanvas = forwardRef<CanvasRef, PaintCanvasProps>(({ imageUrl, color, brushSize, onPaintStart, onHistoryUpdate, onActiveColorsChange }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isPainting, setIsPainting] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const lastPanPoint = useRef({ x: 0, y: 0 });
  
  const historyRef = useRef<PathHistoryItem[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const currentPathRef = useRef<Path2D | null>(null);
  const hasPaintedOnPath = useRef(false);

  const imageRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRenderInfoRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  
  const [transform, setTransform] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
  const [mousePos, setMousePos] = useState<{x: number, y: number} | null>(null);

  const getCanvasCtx = useCallback(() => canvasRef.current?.getContext('2d'), []);

  const updateActiveColors = useCallback(() => {
    const activeHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
    const activeColors = new Set(activeHistory.map(item => item.color));
    onActiveColorsChange(activeColors);
  }, [onActiveColorsChange]);

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = getCanvasCtx();
    const image = imageRef.current;
    if (!canvas || !ctx || !image) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.translate(transform.offsetX, transform.offsetY);
    ctx.scale(transform.scale, transform.scale);
    
    const { x, y, width, height } = imageRenderInfoRef.current;
    ctx.drawImage(image, x, y, width, height);
    
    ctx.save();
    ctx.translate(x, y); 
    
    const pathsToDraw = historyRef.current.slice(0, historyIndexRef.current + 1);
    
    pathsToDraw.forEach(item => {
        ctx.strokeStyle = hexToRgba(item.color, 0.5);
        ctx.lineWidth = item.brushSize / transform.scale; 
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke(item.path);
    });

    if (isPainting && currentPathRef.current) {
        ctx.strokeStyle = hexToRgba(color, 0.5);
        ctx.lineWidth = brushSize / transform.scale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke(currentPathRef.current);
    }

    ctx.restore(); 
    ctx.restore(); 
  }, [brushSize, transform, color, isPainting, getCanvasCtx]);
  
  // Brush Preview Effect
  useEffect(() => {
    const previewCanvas = previewCanvasRef.current;
    const ctx = previewCanvas?.getContext('2d');
    if (!ctx || !previewCanvas) return;
    
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    
    if (mousePos && !isPanning) {
        ctx.beginPath();
        ctx.arc(mousePos.x, mousePos.y, brushSize / 2, 0, 2 * Math.PI);
        ctx.fillStyle = hexToRgba(color, 0.5);
        ctx.fill();
    }
  }, [mousePos, brushSize, color, isPanning]);


  const fitAndCenterImage = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;

    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;
    const imageAspectRatio = image.naturalWidth / image.naturalHeight;
    const canvasAspectRatio = canvasWidth / canvasHeight;

    let renderWidth, renderHeight, x, y;

    if (imageAspectRatio > canvasAspectRatio) {
        renderWidth = canvasWidth;
        renderHeight = canvasWidth / imageAspectRatio;
        x = 0;
        y = (canvasHeight - renderHeight) / 2;
    } else {
        renderHeight = canvasHeight;
        renderWidth = canvasHeight * imageAspectRatio;
        y = 0;
        x = (canvasWidth - renderWidth) / 2;
    }

    imageRenderInfoRef.current = { x, y, width: renderWidth, height: renderHeight };
    redrawCanvas();
  }, [redrawCanvas]);

  const fitCanvasToContainer = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const { clientWidth, clientHeight } = container;
    const dpr = window.devicePixelRatio || 1;
    
    [canvasRef, previewCanvasRef].forEach(cRef => {
        const canvas = cRef.current;
        if (canvas) {
            canvas.style.width = `${clientWidth}px`;
            canvas.style.height = `${clientHeight}px`;
            canvas.width = clientWidth * dpr;
            canvas.height = clientHeight * dpr;
            const ctx = canvas.getContext('2d');
            if(ctx) ctx.scale(dpr, dpr);
        }
    });

    fitAndCenterImage();
  }, [fitAndCenterImage]);

  useEffect(() => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = imageUrl;
    image.onload = () => {
      imageRef.current = image;
      fitCanvasToContainer();
    };
  }, [imageUrl, fitCanvasToContainer]);
  
  useEffect(() => {
    window.addEventListener('resize', fitCanvasToContainer);
    return () => window.removeEventListener('resize', fitCanvasToContainer);
  }, [fitCanvasToContainer]);
  
  useEffect(() => {
    redrawCanvas();
  }, [transform, redrawCanvas]);

  const getCoords = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    
    const canvasX = (screenX - transform.offsetX) / transform.scale;
    const canvasY = (screenY - transform.offsetY) / transform.scale;
    
    const { x, y } = imageRenderInfoRef.current;
    const imageX = canvasX - x;
    const imageY = canvasY - y;

    return { screenX, screenY, imageX, imageY };
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) { // Middle mouse button
        e.preventDefault();
        setIsPanning(true);
        lastPanPoint.current = { x: e.clientX, y: e.clientY };
    } else if (e.button === 0) { // Left mouse button
        startPainting(e);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePos({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
    if (isPanning) {
        e.preventDefault();
        const dx = e.clientX - lastPanPoint.current.x;
        const dy = e.clientY - lastPanPoint.current.y;
        lastPanPoint.current = { x: e.clientX, y: e.clientY };
        setTransform(prev => ({...prev, offsetX: prev.offsetX + dx, offsetY: prev.offsetY + dy}));
    } else if (isPainting) {
        paint(e);
    }
  };
  
  const handleMouseUp = (e: React.MouseEvent) => {
     if (e.button === 1) {
        setIsPanning(false);
     } else if (e.button === 0) {
        stopPainting(e);
     }
  };
  
  const handleMouseLeave = (e: React.MouseEvent) => {
      setMousePos(null);
      if(isPainting) stopPainting(e);
      if(isPanning) setIsPanning(false);
  }

  // Effect to fix page scroll on zoom
  useEffect(() => {
    const canvas = containerRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const scaleAmount = -e.deltaY * 0.001;
        setTransform(prev => {
            const newScale = Math.max(0.1, Math.min(10, prev.scale + scaleAmount));
            const newOffsetX = mouseX - (mouseX - prev.offsetX) * (newScale / prev.scale);
            const newOffsetY = mouseY - (mouseY - prev.offsetY) * (newScale / prev.scale);
            return { scale: newScale, offsetX: newOffsetX, offsetY: newOffsetY };
        });
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);


  const startPainting = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const coords = getCoords(e);
    if (!coords) return;
    setIsPainting(true);
    onPaintStart();
    hasPaintedOnPath.current = false;
    currentPathRef.current = new Path2D();
    currentPathRef.current.moveTo(coords.imageX, coords.imageY);
  };
  
  const paint = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isPainting || !currentPathRef.current) return;
    const coords = getCoords(e);
    if (!coords) return;

    currentPathRef.current.lineTo(coords.imageX, coords.imageY);
    hasPaintedOnPath.current = true;
    redrawCanvas();
  };

  const stopPainting = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isPainting || !currentPathRef.current) return;
    
    setIsPainting(false);
    
    if (hasPaintedOnPath.current) {
        const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
        newHistory.push({ color, path: currentPathRef.current, brushSize });
        historyRef.current = newHistory;
        historyIndexRef.current = newHistory.length - 1;
        onHistoryUpdate();
        updateActiveColors();
    }

    currentPathRef.current = null;
    redrawCanvas();
  };

  useImperativeHandle(ref, () => {
    const getMaskAsBase64 = async (maskColor: string): Promise<string | null> => {
      const activeHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
      const pathsForColor = activeHistory.filter(item => item.color === maskColor);

      const img = imageRef.current;
      if (pathsForColor.length === 0 || !img) return null;

      const offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = img.naturalWidth;
      offscreenCanvas.height = img.naturalHeight;
      const ctx = offscreenCanvas.getContext('2d');
      if (!ctx) return null;

      // The worker spec expects an 8-bit PNG, typically black and white.
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
      
      const { width: renderWidth } = imageRenderInfoRef.current;
      const finalScale = img.naturalWidth / renderWidth;
      ctx.scale(finalScale, finalScale);
      
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'white';
      
      pathsForColor.forEach(({path, brushSize}) => {
        ctx.lineWidth = brushSize * finalScale;
        ctx.stroke(path);
      });

      return offscreenCanvas.toDataURL('image/png');
    };

    const getCombinedMaskAsBase64 = async (maskColors: string[]): Promise<string | null> => {
        const activeHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
        const pathsForColors = activeHistory.filter(item => maskColors.includes(item.color));

        const img = imageRef.current;
        if (pathsForColors.length === 0 || !img) return null;

        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = img.naturalWidth;
        offscreenCanvas.height = img.naturalHeight;
        const ctx = offscreenCanvas.getContext('2d');
        if (!ctx) return null;

        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
        
        const { width: renderWidth } = imageRenderInfoRef.current;
        const finalScale = img.naturalWidth / renderWidth;
        ctx.scale(finalScale, finalScale);
        
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'white';
        
        pathsForColors.forEach(({path, brushSize}) => {
          ctx.lineWidth = brushSize * finalScale;
          ctx.stroke(path);
        });

        return offscreenCanvas.toDataURL('image/png');
    };

    return {
      getHistoryState: () => ({
        canUndo: historyIndexRef.current > -1,
        canRedo: historyIndexRef.current < historyRef.current.length - 1,
      }),
      getMaskAsBase64,
      extractPatchForColor: async (patchColor: string): Promise<string | null> => {
        const activeHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
        const pathsForColor = activeHistory.filter(item => item.color === patchColor);
    
        const img = imageRef.current;
        if (pathsForColor.length === 0 || !img) return null;
    
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = img.naturalWidth;
        maskCanvas.height = img.naturalHeight;
        const maskCtx = maskCanvas.getContext('2d');
        if (!maskCtx) return null;
    
        const { width: renderWidth } = imageRenderInfoRef.current;
        const finalScale = img.naturalWidth / renderWidth;
        maskCtx.scale(finalScale, finalScale);
        
        maskCtx.lineCap = 'round';
        maskCtx.lineJoin = 'round';
        maskCtx.strokeStyle = 'white';
        maskCtx.fillStyle = 'white';
    
        pathsForColor.forEach(({ path, brushSize }) => {
            maskCtx.lineWidth = brushSize * finalScale;
            maskCtx.stroke(path);
        });
    
        const patchCanvas = document.createElement('canvas');
        patchCanvas.width = img.naturalWidth;
        patchCanvas.height = img.naturalHeight;
        const patchCtx = patchCanvas.getContext('2d');
        if (!patchCtx) return null;
    
        patchCtx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
        patchCtx.globalCompositeOperation = 'destination-in';
        patchCtx.drawImage(maskCanvas, 0, 0);
    
        return patchCanvas.toDataURL('image/png');
      },
      exportAllMasks: async () => {
          const masks: Record<string, string> = {};
          const activeHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
          const allColors = [...new Set(activeHistory.map(item => item.color))];
          for (const c of allColors) {
              const maskData = await getMaskAsBase64(c);
              if (maskData) {
                  masks[c] = maskData;
              }
          }
          return masks;
      },
      clearCanvas: () => {
          historyRef.current = [];
          historyIndexRef.current = -1;
          redrawCanvas();
          onHistoryUpdate();
          updateActiveColors();
          setTransform({ scale: 1, offsetX: 0, offsetY: 0 });
          fitAndCenterImage();
      },
      undo: () => {
        if (historyIndexRef.current > -1) {
            historyIndexRef.current -= 1;
            redrawCanvas();
            onHistoryUpdate();
            updateActiveColors();
        }
      },
      redo: () => {
        if (historyIndexRef.current < historyRef.current.length - 1) {
            historyIndexRef.current += 1;
            redrawCanvas();
            onHistoryUpdate();
            updateActiveColors();
        }
      },
      deletePathsForColor: (colorToDelete: string) => {
        historyRef.current = historyRef.current.filter(item => item.color !== colorToDelete);
        historyIndexRef.current = Math.min(historyIndexRef.current, historyRef.current.length - 1);
        redrawCanvas();
        onHistoryUpdate();
        updateActiveColors();
      },
      getNaturalSize: () => {
        const img = imageRef.current;
        return img ? { width: img.naturalWidth, height: img.naturalHeight } : { width: 0, height: 0 };
      },
      getMaskBBox: (maskColor: string) => {
        const activeHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
        const pathsForColor = activeHistory.filter(item => item.color === maskColor);
        const img = imageRef.current;
        if (pathsForColor.length === 0 || !img) return null;
  
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = img.naturalWidth;
        offscreenCanvas.height = img.naturalHeight;
        const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
  
        const { width: renderWidth } = imageRenderInfoRef.current;
        const finalScale = img.naturalWidth / renderWidth;
        ctx.scale(finalScale, finalScale);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'white';
        pathsForColor.forEach(({ path, brushSize }) => {
          ctx.lineWidth = brushSize * finalScale;
          ctx.stroke(path);
        });
  
        const imageData = ctx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
        const data = imageData.data;
        let minX = offscreenCanvas.width, minY = offscreenCanvas.height, maxX = -1, maxY = -1;
  
        for (let y = 0; y < offscreenCanvas.height; y++) {
          for (let x = 0; x < offscreenCanvas.width; x++) {
            const i = (y * offscreenCanvas.width + x) * 4;
            if (data[i] > 0) { // Check Red channel for white pixel
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
  
        if (maxX === -1) return null; // No mask pixels found
        
        const padding = 12;
        const x = Math.max(0, minX - padding);
        const y = Math.max(0, minY - padding);
        const w = Math.min(img.naturalWidth - x, (maxX - minX) + 1 + (padding * 2));
        const h = Math.min(img.naturalHeight - y, (maxY - minY) + 1 + (padding * 2));

        return { x, y, w, h };
      },
      getMaskPNG: async (maskColor: string) => {
        const b64 = await getMaskAsBase64(maskColor);
        if (!b64) return null;
        const res = await fetch(b64);
        return await res.blob();
      },
      getCombinedMaskPNG: async (maskColors: string[]) => {
        const b64 = await getCombinedMaskAsBase64(maskColors);
        if (!b64) return null;
        const res = await fetch(b64);
        return await res.blob();
      },
    };
  }, [redrawCanvas, onHistoryUpdate, fitAndCenterImage, updateActiveColors, brushSize, color]);

  return (
    <div ref={containerRef} className="relative w-full h-full bg-gray-900 overflow-hidden flex items-center justify-center touch-none">
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={startPainting}
        onTouchMove={paint}
        onTouchEnd={stopPainting}
        style={{ cursor: isPanning ? 'grabbing' : isPainting ? 'none' : 'crosshair' }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <canvas
        ref={previewCanvasRef}
        className="absolute top-0 left-0 pointer-events-none"
        style={{ cursor: 'none' }}
      />
    </div>
  );
});

export default PaintCanvas;