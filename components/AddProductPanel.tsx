/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect } from 'react';
import { UploadIcon } from './icons';
import { validateImageFile } from '../lib/fileValidation';

interface AddProductPanelProps {
  onGenerate: (designFile: File, prompt: string) => void;
  isLoading: boolean;
}

const AddProductPanel: React.FC<AddProductPanelProps> = ({ onGenerate, isLoading }) => {
  const [designFile, setDesignFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState<string>('');
  const [designPreview, setDesignPreview] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (designFile) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setDesignPreview(reader.result as string);
      };
      reader.readAsDataURL(designFile);
    } else {
      setDesignPreview(null);
    }
  }, [designFile]);
  
  const handleFileSelect = (file: File | null) => {
    if (file) {
      const { valid, error } = validateImageFile(file);
      if (!valid) {
        setUploadError(error || "Unsupported file type.");
        setDesignFile(null);
        return;
      }
      setUploadError(null);
      setDesignFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files?.[0] || null);
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (designFile && prompt.trim()) {
      onGenerate(designFile, prompt);
    }
  };
  
  const isButtonDisabled = isLoading || !prompt.trim() || !designFile;
  
  return (
    <div className="w-full bg-gray-800/50 border border-gray-700 rounded-lg p-4 flex flex-col items-center gap-4 animate-fade-in backdrop-blur-sm">
        <h3 className="text-lg font-semibold text-center text-gray-300">Add your Product/Design</h3>
        <p className="text-sm text-center text-gray-400 -mt-2">Upload your product design or your product to an environment.</p>
        
        <form onSubmit={handleSubmit} className="w-full flex flex-col items-center gap-4">
            <div className="w-full flex flex-col sm:flex-row items-center gap-4">
                <label 
                    htmlFor="design-upload" 
                    className={`w-full sm:w-1/3 h-40 flex flex-col items-center justify-center border-2 border-dashed rounded-lg cursor-pointer transition-colors ${isDraggingOver ? 'border-blue-400 bg-blue-500/10' : 'border-gray-600 hover:bg-gray-700/50 hover:border-gray-500'}`}
                    onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
                    onDragLeave={() => setIsDraggingOver(false)}
                    onDrop={(e) => {
                        e.preventDefault();
                        setIsDraggingOver(false);
                        handleFileSelect(e.dataTransfer.files?.[0] || null);
                    }}
                >
                    {designPreview ? (
                        <img src={designPreview} alt="Design preview" className="w-full h-full object-contain rounded-lg p-2" />
                    ) : (
                        <div className="text-center text-gray-400">
                            <UploadIcon className="w-8 h-8 mx-auto mb-2" />
                            <span>Upload Design</span>
                            <span className="text-xs block mt-1">or drag & drop</span>
                        </div>
                    )}
                </label>
                <input id="design-upload" type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="e.g., 'place this design on the front of the shirt' or 'place this product in this environment'"
                    className="flex-grow w-full sm:w-2/3 h-40 bg-gray-800 border border-gray-600 text-gray-200 rounded-lg p-4 focus:ring-2 focus:ring-blue-500 focus:outline-none transition disabled:cursor-not-allowed disabled:opacity-60 text-base resize-none"
                    disabled={isLoading}
                />
            </div>
            
            {uploadError && (
              <p className="text-red-400 text-sm -mt-2">{uploadError}</p>
            )}

            <button 
                type="submit"
                className="w-full max-w-md bg-gradient-to-br from-blue-600 to-blue-500 text-white font-bold py-4 px-8 text-lg rounded-lg transition-all duration-300 ease-in-out shadow-lg shadow-blue-500/20 hover:shadow-xl hover:shadow-blue-500/40 hover:-translate-y-px active:scale-95 active:shadow-inner disabled:from-gray-600 disabled:to-gray-700 disabled:shadow-none disabled:cursor-not-allowed disabled:transform-none disabled:opacity-70"
                disabled={isButtonDisabled}
            >
                {isLoading ? 'Generating...' : isButtonDisabled ? 'Awaiting Product/Design...' : 'Generate'}
            </button>
        </form>
    </div>
  );
};

export default AddProductPanel;