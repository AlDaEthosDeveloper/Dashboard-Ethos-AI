import { useEffect } from 'react';
import { FolderOpen, Folder, RefreshCw, Pause, Play, X, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useUpload } from '@/contexts/UploadContext';
import { useDashboard } from '@/contexts/DashboardContext';

/**
 * Executes `FolderScannerUI`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export function FolderScannerUI() {
  const { addErrors, addEvents, addReplacements } = useDashboard();
  const {
    directoryHandle,
    isScanning,
    isWatching,
    scannedFiles,
    processedCount,
    selectFolder,
    startWatching,
    stopWatching,
    disconnect,
    manualRefresh,
    registerCallbacks,
    isSupported,
    isInIframe,
  } = useUpload();

  // Register callbacks when component mounts
  useEffect(() => {
    registerCallbacks(addErrors, addEvents, addReplacements);
  }, [registerCallbacks, addErrors, addEvents, addReplacements]);

  if (!isSupported) {
    return (
      <div className="p-4 rounded-lg bg-secondary/30 border border-border">
        <p className="text-sm text-muted-foreground">
          File System Access API is not supported in this browser. 
          Please use Chrome, Edge, or Opera for folder scanning.
        </p>
      </div>
    );
  }

  if (isInIframe && !directoryHandle) {
    return (
      <div className="p-4 rounded-lg bg-secondary/30 border border-border space-y-3">
        <p className="text-sm text-muted-foreground">
          Folder scanning requires the app to run in its own browser window due to security restrictions.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open(window.location.href, '_blank')}
          className="gap-2"
        >
          <FolderOpen className="w-4 h-4" />
          Open in new tab
        </Button>
      </div>
    );
  }

  if (!directoryHandle) {
    return (
      <Button
        variant="outline"
        onClick={selectFolder}
        className="gap-2 w-full justify-start"
        disabled={isScanning}
      >
        {isScanning ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <FolderOpen className="w-4 h-4" />
        )}
        Select Folder to Scan
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="secondary" className="gap-1">
          <Folder className="w-3 h-3" />
          {directoryHandle.name}
        </Badge>
        <Badge variant="outline">{scannedFiles.length} files tracked</Badge>
        {isWatching && (
          <Badge variant="default" className="gap-1">
            Watching
          </Badge>
        )}
        {isScanning && (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            Processing {processedCount > 0 ? `(${processedCount})` : '...'}
          </Badge>
        )}
      </div>
      
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={manualRefresh}
          disabled={isScanning}
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        
        {isWatching ? (
          <Button
            variant="outline"
            size="sm"
            onClick={stopWatching}
            className="gap-2"
          >
            <Pause className="w-4 h-4" />
            Stop Watching
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={startWatching}
            className="gap-2"
          >
            <Play className="w-4 h-4" />
            Watch for Changes
          </Button>
        )}
        
        <Button
          variant="ghost"
          size="sm"
          onClick={disconnect}
          className="gap-2 text-muted-foreground"
        >
          <X className="w-4 h-4" />
          Disconnect
        </Button>
      </div>
      
      {scannedFiles.length > 0 && (
        <div className="text-xs text-muted-foreground max-h-24 overflow-y-auto space-y-0.5">
          {scannedFiles.slice(0, 10).map((file, i) => (
            <div key={i} className="flex items-center gap-1">
              <FileText className="w-3 h-3" />
              <span className="truncate">{file.path}</span>
            </div>
          ))}
          {scannedFiles.length > 10 && (
            <div className="text-muted-foreground">
              ...and {scannedFiles.length - 10} more files
            </div>
          )}
        </div>
      )}
    </div>
  );
}
