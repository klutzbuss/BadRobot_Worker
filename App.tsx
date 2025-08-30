/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useState, useCallback, useRef, useEffect } from 'react';
import { generateProductImage } from './services/geminiService';
import Header from './components/Header';
import Spinner from './components/Spinner';
import AddProductPanel from './components/AddProductPanel';
import CorrectionPanel, { CorrectionPanelRef, CorrectionHistoryState } from './components/CorrectionPanel';
import { UndoIcon, RedoIcon, EyeIcon } from './components/icons';
import StartScreen from './components/StartScreen';
import ResultScreen from './components/ResultScreen';
import { validateImageFile } from './lib/fileValidation';

// Helper to convert a data URL string to a File object
const dataURLtoFile = (dataurl: string, filename: string): File => {
    const arr = dataurl.split(',');
    if (arr.length < 2) throw new Error("Invalid data URL");
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch || !mimeMatch[1]) throw new Error("Could not parse MIME type from data URL");

    const mime = mimeMatch[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, {type:mime});
}

type Tab = 'addProduct' | 'correction';
type View = 'editing' | 'result';

const App: React.FC = () => {
  const [history, setHistory] = useState<File[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('addProduct');
  const [correctionHistory, setCorrectionHistory] = useState<CorrectionHistoryState>({ canUndo: false, canRedo: false });
  const [hasReferenceImage, setHasReferenceImage] = useState<boolean>(false);
  const [view, setView] = useState<View>('editing');
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  
  const correctionPanelRef = useRef<CorrectionPanelRef>(null);

  const currentImage = history[historyIndex] ?? null;

  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null);

  // Effect to create and revoke object URLs safely for the current image
  useEffect(() => {
    if (currentImage) {
      const url = URL.createObjectURL(currentImage);
      setCurrentImageUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setCurrentImageUrl(null);
    }
  }, [currentImage]);
  
  const isUndoDisabled = activeTab === 'correction' ? !correctionHistory.canUndo : historyIndex <= 0;
  // FIX: Fix typo from `active-tab` to `activeTab` to correctly reference the state variable.
  const isRedoDisabled = activeTab === 'correction' ? !correctionHistory.canRedo : historyIndex >= history.length - 1;
  const isResetDisabled = activeTab === 'correction' ? !correctionHistory.canUndo : historyIndex <= 0;

  const addImageToHistory = useCallback((newImageFile: File) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newImageFile);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex]);

  const handleImageUpload = useCallback((file: File) => {
    setError(null);
    setHistory([file]);
    setHistoryIndex(0);
    setActiveTab('addProduct');
    setHasReferenceImage(false);
  }, []);
  
  const handleReplaceSourceImage = useCallback((file: File) => {
    setError(null);
    const newHistory = [...history];
    newHistory[0] = file;
    setHistory(newHistory);
    setHistoryIndex(0); // Reset to the new base image
    correctionPanelRef.current?.reset();
  }, [history]);

  const handleGenerateProduct = useCallback(async (designFile: File, prompt: string) => {
    if (!currentImage) {
      setError('No base image loaded to add a product to.');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
        const editedImageUrl = await generateProductImage(currentImage, designFile, prompt);
        const newImageFile = dataURLtoFile(editedImageUrl, `product-${Date.now()}.png`);
        addImageToHistory(newImageFile);
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(`Failed to generate the product image. ${errorMessage}`);
        console.error(err);
    } finally {
        setIsLoading(false);
    }
  }, [currentImage, addImageToHistory]);
  
  const handleUndo = useCallback(() => {
    if (activeTab === 'correction') {
        correctionPanelRef.current?.undo();
    } else if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
    }
  }, [activeTab, historyIndex]);
  
  const handleRedo = useCallback(() => {
    if (activeTab === 'correction') {
        correctionPanelRef.current?.redo();
    } else if (historyIndex < history.length - 1) {
      // FIX: Redo should increment the history index, not decrement it.
      setHistoryIndex(historyIndex + 1);
    }
  }, [activeTab, historyIndex, history.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        const isCtrl = e.ctrlKey || e.metaKey;
        if (isCtrl && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) {
                handleRedo();
            } else {
                handleUndo();
            }
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
        window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleUndo, handleRedo]);

  const handleReset = useCallback(() => {
    if (activeTab === 'correction') {
        correctionPanelRef.current?.reset();
    } else if (history.length > 0) {
      setHistoryIndex(0);
    }
    setError(null);
  }, [activeTab, history]);

  const handleFileSelect = (files: FileList | null) => {
    if (files && files[0]) {
      const file = files[0];
      const { valid, error: validationError } = validateImageFile(file);
      if (!valid) {
        setError(validationError || "Unsupported file type. Please insert a PNG, JPEG, or JPG file.");
        return;
      }
      handleImageUpload(file);
    }
  };

  const renderContent = () => {
    const errorDisplay = error && (
       <div className="w-full max-w-4xl text-center animate-fade-in bg-red-500/10 border border-red-500/20 p-4 rounded-lg flex items-center justify-between gap-4">
        <div className="text-left">
            <h2 className="font-bold text-red-300">An Error Occurred</h2>
            <p className="text-sm text-red-400">{error}</p>
        </div>
        <button
            onClick={() => setError(null)}
            className="bg-red-500/20 hover:bg-red-500/40 text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors"
          >
            Dismiss
        </button>
      </div>
    );

    if (!currentImageUrl || !currentImage) {
      return (
        <div className="flex flex-col items-center gap-6">
          {errorDisplay}
          <StartScreen onFileSelect={handleFileSelect} />
        </div>
      );
    }

    if (view === 'result' && resultUrl) {
      return (
        <ResultScreen
          resultUrl={resultUrl}
          onBack={() => setView('editing')}
          onStartOver={() => {
            setResultUrl(null);
            setView('editing');
            setActiveTab('addProduct');
            if (history.length > 0) {
              const firstImage = history[0];
              setHistory([firstImage]);
              setHistoryIndex(0);
            }
            correctionPanelRef.current?.reset();
          }}
        />
      );
    }

    const showMainImage = activeTab === 'addProduct' || (activeTab === 'correction' && !hasReferenceImage);

    const imageDisplay = (
      <div className="relative w-full max-w-4xl shadow-2xl rounded-xl overflow-hidden bg-black/20">
        {isLoading && activeTab !== 'correction' && (
            <div className="absolute inset-0 bg-black/70 z-30 flex flex-col items-center justify-center gap-4 animate-fade-in">
                <Spinner />
                <p className="text-gray-300">AI is working its magic...</p>
            </div>
        )}
        <div className="relative">
            <img
                src={currentImageUrl}
                alt={"Current"}
                className="w-full h-auto object-contain max-h-[60vh] rounded-xl"
            />
        </div>
      </div>
    );

    return (
      <div className="w-full max-w-7xl mx-auto flex flex-col items-center gap-6 animate-fade-in">
        { showMainImage && imageDisplay }
        
        {errorDisplay}

        <div className="w-full max-w-4xl bg-gray-800/80 border border-gray-700/80 rounded-lg p-2 flex items-center justify-center gap-2 backdrop-blur-sm">
            {(['addProduct', 'correction'] as Tab[]).map(tab => (
                 <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`w-full capitalize font-semibold py-3 px-5 rounded-md transition-all duration-200 text-base ${
                        activeTab === tab 
                        ? 'bg-gradient-to-br from-blue-500 to-cyan-400 text-white shadow-lg shadow-cyan-500/40' 
                        : 'text-gray-300 hover:text-white hover:bg-white/10'
                    }`}
                >
                    {tab === 'addProduct' ? 'Add Product/Design' : 'Correction'}
                </button>
            ))}
        </div>
        
        <div className="w-full max-w-4xl">
            <div style={{ display: activeTab === 'addProduct' ? 'block' : 'none' }}>
                <AddProductPanel onGenerate={handleGenerateProduct} isLoading={isLoading} />
            </div>
            <div style={{ display: activeTab === 'correction' ? 'block' : 'none' }}>
              {currentImageUrl && (
                <CorrectionPanel 
                  ref={correctionPanelRef}
                  sourceImage={currentImage}
                  sourceImageUrl={currentImageUrl}
                  onCorrectionReady={(url: string) => {
                    setResultUrl(url);
                    setView('result');
                  }}
                  onError={setError}
                  onHistoryUpdate={setCorrectionHistory}
                  onReferenceImageUpload={setHasReferenceImage}
                  onReplaceSourceImage={handleReplaceSourceImage}
                />
              )}
            </div>
        </div>
        
        <div className="w-full max-w-4xl flex flex-col items-center gap-3 mt-6">
            {activeTab === 'correction' && hasReferenceImage && (
                <div className="flex flex-wrap items-center justify-center gap-3">
                    <button 
                        onClick={handleUndo}
                        disabled={isUndoDisabled}
                        className="flex items-center justify-center text-center bg-white/10 border border-white/20 text-gray-200 font-semibold py-3 px-5 rounded-md transition-all duration-200 ease-in-out hover:bg-white/20 hover:border-white/30 active:scale-95 text-base disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-white/5"
                        aria-label="Undo last action (Ctrl+Z)"
                    >
                        <UndoIcon className="w-5 h-5 mr-2" />
                        Undo
                    </button>
                    <button 
                        onClick={handleRedo}
                        disabled={isRedoDisabled}
                        className="flex items-center justify-center text-center bg-white/10 border border-white/20 text-gray-200 font-semibold py-3 px-5 rounded-md transition-all duration-200 ease-in-out hover:bg-white/20 hover:border-white/30 active:scale-95 text-base disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-white/5"
                        aria-label="Redo last action (Ctrl+Shift+Z)"
                    >
                        <RedoIcon className="w-5 h-5 mr-2" />
                        Redo
                    </button>
                    
                    <div className="h-6 w-px bg-gray-600 mx-1 hidden sm:block"></div>

                    <button 
                        onClick={handleReset}
                        disabled={isResetDisabled}
                        className="text-center bg-transparent border border-white/20 text-gray-200 font-semibold py-3 px-5 rounded-md transition-all duration-200 ease-in-out hover:bg-white/10 hover:border-white/30 active:scale-95 text-base disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-transparent"
                      >
                        Reset
                    </button>
                </div>
            )}
        </div>
      </div>
    );
  };
  
  return (
    <div className="min-h-screen text-gray-100 flex flex-col">
      <Header />
      <main className={`flex-grow w-full max-w-[1600px] mx-auto p-4 md:p-8 flex justify-center ${currentImage ? 'items-start' : 'items-center'}`}>
        {renderContent()}
      </main>
    </div>
  );
};

export default App;
