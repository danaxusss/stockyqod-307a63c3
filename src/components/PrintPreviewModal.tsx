import React, { useEffect, useRef, useState } from 'react';
import { X, Printer, Download } from 'lucide-react';

interface PrintPreviewModalProps {
  blob: Blob;
  filename: string;
  onClose: () => void;
}

export function PrintPreviewModal({ blob, filename, onClose }: PrintPreviewModalProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [objectUrl, setObjectUrl] = useState<string>('');

  useEffect(() => {
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  const handlePrint = () => {
    iframeRef.current?.contentWindow?.print();
  };

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-card border-b border-border flex-shrink-0">
        <span className="text-sm font-medium text-foreground truncate max-w-xs">{filename}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm"
          >
            <Printer className="h-3.5 w-3.5" /><span>Imprimer</span>
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary hover:bg-accent text-foreground border border-border rounded-lg text-sm"
          >
            <Download className="h-3.5 w-3.5" /><span>Télécharger</span>
          </button>
          <button onClick={onClose} className="p-1.5 hover:bg-accent rounded-lg text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {/* Preview */}
      <div className="flex-1 overflow-hidden">
        {objectUrl && (
          <iframe
            ref={iframeRef}
            src={objectUrl}
            className="w-full h-full border-0"
            title="Aperçu PDF"
          />
        )}
      </div>
    </div>
  );
}
