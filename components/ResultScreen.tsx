/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect } from 'react';
import { ArrowLeftIcon } from './icons';

type Props = {
  resultUrl: string;
  onBack: () => void;       // go back to correction view
  onStartOver: () => void;  // go to add product/design & clear resultUrl
};

const ResultScreen: React.FC<Props> = ({ resultUrl, onBack, onStartOver }) => {
  // Revoke if this component unmounts
  useEffect(() => {
    return () => {
      if (resultUrl) {
        try {
          URL.revokeObjectURL(resultUrl);
        } catch {}
      }
    };
  }, [resultUrl]);

  const handleDownload = async () => {
    const a = document.createElement('a');
    a.href = resultUrl;
    a.download = 'correction.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="w-full max-w-5xl mx-auto text-center pt-6 pb-12 animate-fade-in">
      <h2 className="text-2xl font-bold mb-4">Correction Complete</h2>
      <div className="w-full rounded-lg overflow-hidden border border-gray-700 bg-black/30 shadow-2xl">
        <img
          src={resultUrl}
          alt="Corrected result"
          className="w-full h-auto block"
          style={{ objectFit: 'contain', maxHeight: '70vh' }}
        />
      </div>

      <div className="flex flex-wrap gap-4 justify-center mt-6">
        <button onClick={handleDownload} className="flex items-center justify-center text-center bg-gradient-to-br from-green-600 to-green-500 text-white font-bold py-3 px-6 rounded-md transition-all duration-300 ease-in-out shadow-lg shadow-green-500/20 hover:shadow-xl hover:shadow-green-500/40 hover:-translate-y-px active:scale-95 active:shadow-inner text-base">
          Download Image
        </button>
        <button onClick={onBack} className="flex items-center justify-center text-center bg-white/10 border border-white/20 text-gray-200 font-semibold py-3 px-5 rounded-md transition-all duration-200 ease-in-out hover:bg-white/20 hover:border-white/30 active:scale-95 text-base">
          <ArrowLeftIcon className="w-5 h-5 mr-2" />
          Back to Correction
        </button>
        <button onClick={onStartOver} className="text-center bg-transparent border border-white/20 text-gray-200 font-semibold py-3 px-5 rounded-md transition-all duration-200 ease-in-out hover:bg-white/10 hover:border-white/30 active:scale-95 text-base">
          Start Over
        </button>
      </div>
    </div>
  );
};

export default ResultScreen;
