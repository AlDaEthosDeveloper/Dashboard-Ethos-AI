import { useState, useCallback, useRef, useEffect } from 'react';
import { FolderOpen, Folder, RefreshCw, Pause, Play, X, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import JSZip from 'jszip';
import { MLCError, MachineId, getMachineIds } from '@/data/mlcErrorData';
import { GenericEvent, normalizeEventSeverity } from '@/data/genericEventData';
import { EventLogType } from '@/data/eventLogTypes';
import { parseXMLLogContent } from '@/lib/xmlLogParser';
import { parseGenericEventLog } from '@/lib/genericEventParser';
import { parseCombinedLogContent, isTxtLogFile } from '@/lib/combinedLogParser';
import { TabColumnFilter } from '@/lib/combinedLogParser';
import { isAnyEventLogFile, detectLogTypeFromFilename, EVENT_LOG_TYPES } from '@/data/eventLogTypes';
import { format } from 'date-fns';

// Extend the FileSystemDirectoryHandle type for async iteration
interface ExtendedFileSystemDirectoryHandle extends FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
}

interface FolderScannerProps {
  onDataLoaded: (machineId: MachineId, errors: MLCError[]) => void;
  onEventsLoaded?: (machineId: MachineId, logType: EventLogType, events: GenericEvent[]) => void;
  onReplacementsLoaded?: (machineId: MachineId, replacements: any[]) => void;
}

interface ScannedFile {
  name: string;
  path: string;
  lastModified: number;
  size: number;
}

interface ProcessedData {
  mlcErrors: Map<MachineId, MLCError[]>;
  genericEvents: Map<MachineId, Map<EventLogType, GenericEvent[]>>;
}


// Centralised CombinedLog filter policy
// ------------------------------------------------------------------
const COMBINED_LOG_FILTERS: TabColumnFilter[] = [
{ columnIndex: 6, includeAny: ['COL', 'STN', 'SPV', 'BGM','CCHU', 'XI', ] }, // Component
{ columnIndex: 7, includeAny: ['Fault',] }, // Severity
{ columnIndex: 8, includeAny: ['raise', 'heartbeat', 'assert'] }, // Message
//{ columnIndex: 8, includeAll: ['Fault'] }, // Severity

{ columnIndex: 0,  exclude: ['1970']}, //invalid timestamp
{ columnIndex: 5, exclude: ['HAL-CR*', 'HAL_TRT*', 'webservicehost']}, //Serial Number
{ columnIndex: 6, exclude: ['CR','OSM.AppEvents' ] }, // Type
{ columnIndex: 7, exclude: ['Controller','Coordinator', 'HardwareAPI', 'Interlock', 'General' ] }, // Severity
{ columnIndex: 8, exclude: ['ack', 'Warning', 'release', '1003', '1004','1005', '1013', '2006', 'Prepare',] }, // Message
];

// Robust ZIP parser - matches eventlog.xml files anywhere in the archive
async function processZipFileRobust(file: File | Blob): Promise<ProcessedData> {
  const mlcErrors = new Map<MachineId, MLCError[]>();
  const genericEvents = new Map<MachineId, Map<EventLogType, GenericEvent[]>>();
  
  // Initialize maps
  getMachineIds().forEach(id => {
    mlcErrors.set(id, []);
    genericEvents.set(id, new Map());
  });
  
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const promises: Promise<void>[] = [];

  zip.forEach((relativePath, zipEntry) => {
    if (zipEntry.dir) return;

    // Normalize path
    let normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

    // Skip system folders
    if (normalizedPath.startsWith('__macosx/')) return;

    // Process COL EventLog files for MLC errors
    if (normalizedPath.endsWith('_coleventlog.xml')) {
      promises.push(
        zipEntry.async('text').then(content => {
          try {
            const parsedErrors = parseXMLLogContent(content, 'HAL2106');
            parsedErrors.forEach(error => {
              const machineId = error.machineSerial as MachineId;
              if (!mlcErrors.has(machineId)) mlcErrors.set(machineId, []);
              mlcErrors.get(machineId)!.push(error);
            });
          } catch (err) {
            console.error('Failed to parse COL XML in ZIP entry', zipEntry.name, err);
          }
        })
      );
    }
    // Process other EventLog files
    else if (normalizedPath.includes('eventlog') && normalizedPath.endsWith('.xml')) {
      const logType = detectLogTypeFromFilename(relativePath);
      if (logType !== 'COL') {
        promises.push(
          zipEntry.async('text').then(content => {
            try {
              const parsedEvents = parseGenericEventLog(content, relativePath, 'HAL2106');
              parsedEvents.forEach(event => {
                const machineId = event.machineSerial;
                if (!genericEvents.has(machineId)) {
                  genericEvents.set(machineId, new Map());
                }
                const machineEvents = genericEvents.get(machineId)!;
                if (!machineEvents.has(event.logType)) {
                  machineEvents.set(event.logType, []);
                }
                machineEvents.get(event.logType)!.push(event);
              });
            } catch (err) {
              console.error('Failed to parse generic EventLog in ZIP entry', zipEntry.name, err);
            }
          })
        );
      }
    }

    // Process TXT log files (Combined logs)
    else if (normalizedPath.endsWith('.txt')) {
      promises.push(
        zipEntry.async('text').then(content => {
          try {
            const result = parseCombinedLogContent(
                content,
                relativePath,
                'HAL2106',
                COMBINED_LOG_FILTERS
                );
            // Add MLC errors
            result.mlcErrors.forEach(error => {
              const machineId = error.machineSerial as MachineId;
              if (!mlcErrors.has(machineId)) mlcErrors.set(machineId, []);
              mlcErrors.get(machineId)!.push(error);
            });
            // Add generic events
            result.genericEvents.forEach(event => {
              const machineId = event.machineSerial;
              if (!genericEvents.has(machineId)) {
                genericEvents.set(machineId, new Map());
              }
              const machineEvents = genericEvents.get(machineId)!;
              if (!machineEvents.has(event.logType)) {
                machineEvents.set(event.logType, []);
              }
              machineEvents.get(event.logType)!.push(event);
            });
          } catch (err) {
            console.error('Failed to parse TXT log in ZIP entry', zipEntry.name, err);
          }
        })
      );
    }
  });

  await Promise.all(promises);
  return { mlcErrors, genericEvents };
}

/**
 * Executes `FolderScanner`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export function FolderScanner({ onDataLoaded, onEventsLoaded, onReplacementsLoaded }: FolderScannerProps) {
  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isWatching, setIsWatching] = useState(false);
  const [scannedFiles, setScannedFiles] = useState<ScannedFile[]>([]);
  const [processedCount, setProcessedCount] = useState(0);
  const watchIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const knownFilesRef = useRef<Map<string, number>>(new Map());

  const isSupported = 'showDirectoryPicker' in window;
  /**
   * Evaluates whether `isInIframe` conditions are met.
   *
   * @param args Function input.
   * @returns Boolean evaluation result.
   */
  const isInIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();

  // Recursively scan directory for ZIP/XML files
  const scanDirectory = useCallback(async (
    handle: FileSystemDirectoryHandle,
    path: string = ''
  ): Promise<ScannedFile[]> => {
    const files: ScannedFile[] = [];
    try {
      for await (const entry of (handle as ExtendedFileSystemDirectoryHandle).values()) {
        const entryPath = path ? `${path}/${entry.name}` : entry.name;

        if (entry.kind === 'directory') {
          const dirHandle = entry as FileSystemDirectoryHandle;
          const subFiles = await scanDirectory(dirHandle, entryPath);
          files.push(...subFiles);
        } else if (entry.kind === 'file') {
          const fileHandle = entry as FileSystemFileHandle;
          const file = await fileHandle.getFile();
          const lowerPath = entryPath.toLowerCase();

          // Track ZIP files, any eventlog.xml files, .txt log files, and backup JSON files
          if (file.name.toLowerCase().endsWith('.zip') || 
              isAnyEventLogFile(lowerPath) || 
              isTxtLogFile(file.name) ||
              (file.name.toLowerCase().endsWith('.json') )) {
            files.push({
              name: file.name,
              path: entryPath,
              lastModified: file.lastModified,
              size: file.size,
            });
          }
        }
      }
    } catch (error) {
      console.error('Error scanning directory:', error);
    }
    return files;
  }, []);

  // Process a single file (ZIP or XML)
  const processFile = useCallback(async (
    handle: FileSystemDirectoryHandle,
    filePath: string
  ): Promise<ProcessedData> => {
    const result: ProcessedData = {
      mlcErrors: new Map(),
      genericEvents: new Map(),
    };
    getMachineIds().forEach(id => {
      result.mlcErrors.set(id, []);
      result.genericEvents.set(id, new Map());
    });
    
    try {
      const pathParts = filePath.split('/');
      let currentHandle: FileSystemDirectoryHandle = handle;
      for (let i = 0; i < pathParts.length - 1; i++) {
        currentHandle = await currentHandle.getDirectoryHandle(pathParts[i]);
      }
      const fileName = pathParts[pathParts.length - 1];
      const fileHandle = await currentHandle.getFileHandle(fileName);
      const file = await fileHandle.getFile();

      if (fileName.toLowerCase().endsWith('.zip')) {
        const zipData = await processZipFileRobust(file);
        zipData.mlcErrors.forEach((errors, machineId) => {
          result.mlcErrors.get(machineId)?.push(...errors);
        });
        zipData.genericEvents.forEach((eventsByType, machineId) => {
          eventsByType.forEach((events, logType) => {
            if (!result.genericEvents.get(machineId)?.has(logType)) {
              result.genericEvents.get(machineId)?.set(logType, []);
            }
            result.genericEvents.get(machineId)?.get(logType)?.push(...events);
          });
        });
      } else if (fileName.toLowerCase().endsWith('_coleventlog.xml')) {
        const content = await file.text();
        const parsedErrors = parseXMLLogContent(content, 'HAL2106');
        parsedErrors.forEach(error => {
          const machineId = error.machineSerial as MachineId;
          result.mlcErrors.get(machineId)?.push(error);
        });
      } else if (isAnyEventLogFile(fileName)) {
        const content = await file.text();
        const parsedEvents = parseGenericEventLog(content, fileName, 'HAL2106');
        parsedEvents.forEach(event => {
          const machineId = event.machineSerial;
          if (!result.genericEvents.get(machineId)?.has(event.logType)) {
            result.genericEvents.get(machineId)?.set(event.logType, []);
          }
          result.genericEvents.get(machineId)?.get(event.logType)?.push(event);
        });
      } else if (isTxtLogFile(fileName)) {
        const content = await file.text();
        const txtResult = parseCombinedLogContent(
          content,
          fileName,
          'HAL2106',
          COMBINED_LOG_FILTERS
          );
        // Add MLC errors
        txtResult.mlcErrors.forEach(error => {
          const machineId = error.machineSerial as MachineId;
          result.mlcErrors.get(machineId)?.push(error);
        });
        // Add generic events
        txtResult.genericEvents.forEach(event => {
          const machineId = event.machineSerial;
          if (!result.genericEvents.get(machineId)?.has(event.logType)) {
            result.genericEvents.get(machineId)?.set(event.logType, []);
          }
          result.genericEvents.get(machineId)?.get(event.logType)?.push(event);
        });
      }
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error);
    }
    return result;
  }, []);


  // Process a backup JSON file directly (v1 and v2)
  const processBackupFile = useCallback(async (
    handle: FileSystemDirectoryHandle,
    filePath: string
  ): Promise<number> => {
    let totalItems = 0;
    try {
      const pathParts = filePath.split('/');
      let currentHandle: FileSystemDirectoryHandle = handle;
      for (let i = 0; i < pathParts.length - 1; i++) {
        currentHandle = await currentHandle.getDirectoryHandle(pathParts[i]);
      }
      const fileName = pathParts[pathParts.length - 1];
      const fileHandle = await currentHandle.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const content = await file.text();
      const raw = JSON.parse(content);

      if (!raw.version || !raw.machines) return 0;

      if (raw.version === 2) {
        const backup = raw as any;
        const mlcEventsByMachine = new Map<MachineId, MLCError[]>();
        const otherEventsByMachine = new Map<MachineId, GenericEvent[]>();

        getMachineIds().forEach((machineId) => {
          mlcEventsByMachine.set(machineId, []);
          otherEventsByMachine.set(machineId, []);
        });

        Object.entries(backup.machines).forEach(([machineId, data]: [string, any]) => {
          // Accept any machine ID from backup
          const id = machineId as MachineId;

          (data.events || []).forEach((evt: any) => {
            const ts = new Date(evt.timestamp);
            const eventMachineId = evt.machineSerial || id;

            if (evt.logType === 'MLC' && evt.mlcMotor != null && evt.bank) {
              mlcEventsByMachine.get(eventMachineId)?.push({
                timestamp: ts,
                machineSerial: eventMachineId,
                errorCode: evt.eventCode,
                location: '',
                region: '',
                country: '',
                component: evt.component,
                errorText: evt.description,
                severity: evt.severity,
                mlcMotor: evt.mlcMotor,
                errorPosition: evt.errorPosition ?? 0,
                bank: evt.bank as 'A' | 'B',
              });
            } else {
              let logType: EventLogType = 'Other';
              const raw = evt.logType?.trim() || '';
              const upper = raw.split('.')[0].toUpperCase();
              // Match both EventLogType names and raw component prefixes
              if (upper === 'COL') logType = 'COL';
              else if (upper === 'MLC') logType = 'MLC';
              else if (upper === 'BEAM' || upper === 'BGM') logType = 'Beam';
              else if (upper === 'MOTION' || upper === 'STN') logType = 'Motion';
              else if (upper === 'IMAGE' || upper === 'XI') logType = 'Image';
              else if (EVENT_LOG_TYPES.includes(raw as EventLogType)) logType = raw as EventLogType;

              otherEventsByMachine.get(eventMachineId)?.push({
                id: evt.id,
                timestamp: ts,
                machineSerial: eventMachineId,
                logType,
                eventCode: evt.eventCode,
                component: evt.component,
                description: evt.description,
                severity: normalizeEventSeverity(evt.severity, evt.description),
                rawData: evt.rawData,
                count: evt.count ?? null,
                min: evt.min ?? null,
                max: evt.max ?? null,
                avg: evt.avg ?? null,
              });
            }
          });

          if (data.replacements && data.replacements.length > 0 && onReplacementsLoaded) {
            const replacements = data.replacements.map((r: any) => ({
              ...r,
              replacementDate: new Date(r.replacementDate),
            }));
            onReplacementsLoaded(id, replacements);
            totalItems += replacements.length;
          }
        });

        mlcEventsByMachine.forEach((mlcEvents, machineId) => {
          if (mlcEvents.length > 0) {
            onDataLoaded(machineId, mlcEvents);
            totalItems += mlcEvents.length;
          }
        });

        otherEventsByMachine.forEach((otherEvents, machineId) => {
          const byType = new Map<EventLogType, GenericEvent[]>();
          otherEvents.forEach((ev) => {
            const arr = byType.get(ev.logType) || [];
            arr.push(ev);
            byType.set(ev.logType, arr);
          });

          byType.forEach((events, logType) => {
            onEventsLoaded?.(machineId, logType, events);
            totalItems += events.length;
          });
        });
      } else {
        const backup = raw as any;
        Object.entries(backup.machines).forEach(([machineId, data]: [string, any]) => {
          // Accept any machine ID from backup
          const id = machineId as MachineId;

          if (data.errors?.length > 0) {
            const errors = data.errors.map((e: any) => ({
              ...e,
              timestamp: new Date(e.timestamp),
            }));
            onDataLoaded(id, errors);
            totalItems += errors.length;
          }

          if (data.replacements?.length > 0 && onReplacementsLoaded) {
            const replacements = data.replacements.map((r: any) => ({
              ...r,
              replacementDate: new Date(r.replacementDate),
            }));
            onReplacementsLoaded(id, replacements);
            totalItems += replacements.length;
          }

          if (data.events) {
            Object.entries(data.events).forEach(([logType, events]: [string, any]) => {
              if (!EVENT_LOG_TYPES.includes(logType as EventLogType)) return;
              if (!Array.isArray(events) || events.length === 0) return;

              const parsed: GenericEvent[] = events.map((e: any) => ({
                ...e,
                timestamp: new Date(e.timestamp),
              }));
              onEventsLoaded?.(id, logType as EventLogType, parsed);
              totalItems += parsed.length;
            });
          }
        });
      }

      toast.success(`Restored backup (${format(new Date(raw.exportDate), 'PPp')}): ${totalItems} items`);
    } catch (err) {
      console.error(`Failed to process backup file ${filePath}:`, err);
    }
    return totalItems;
  }, [onDataLoaded, onEventsLoaded, onReplacementsLoaded]);

  // Process all new/modified files
  const processNewFiles = useCallback(async (
    handle: FileSystemDirectoryHandle,
    files: ScannedFile[],
    isInitial: boolean = false
  ) => {
    const newFiles = files.filter(file => {
      const knownModified = knownFilesRef.current.get(file.path);
      return !knownModified || knownModified < file.lastModified;
    });
    
    if (newFiles.length === 0 && !isInitial) {
      return;
    }
    
    // Update known files
    files.forEach(file => {
      knownFilesRef.current.set(file.path, file.lastModified);
    });
    
    if (newFiles.length === 0) {
      return;
    }
    
    setIsScanning(true);
    toast.info(`Processing ${newFiles.length} new/modified file(s)...`);

    // Separate backup JSON files from regular log files
    const backupFiles = newFiles.filter(f => f.name.toLowerCase().endsWith('.json'));
    const logFiles = newFiles.filter(f => !(f.name.toLowerCase().endsWith('.json')));

    // Process backup files first
    let totalBackupItems = 0;
    for (const file of backupFiles) {
      totalBackupItems += await processBackupFile(handle, file.path);
    }
    
    const allMlcErrors = new Map<MachineId, MLCError[]>();
    const allGenericEvents = new Map<MachineId, Map<EventLogType, GenericEvent[]>>();
    getMachineIds().forEach(id => {
      allMlcErrors.set(id, []);
      allGenericEvents.set(id, new Map());
    });
    
    let processed = 0;
    for (const file of logFiles) {
      const fileData = await processFile(handle, file.path);
      fileData.mlcErrors.forEach((errors, machineId) => {
        allMlcErrors.get(machineId)!.push(...errors);
      });
      fileData.genericEvents.forEach((eventsByType, machineId) => {
        eventsByType.forEach((events, logType) => {
          if (!allGenericEvents.get(machineId)?.has(logType)) {
            allGenericEvents.get(machineId)?.set(logType, []);
          }
          allGenericEvents.get(machineId)?.get(logType)?.push(...events);
        });
      });
      processed++;
      setProcessedCount(processed);
    }
    
    // Dispatch MLC errors to each machine
    let totalMlcErrors = 0;
    allMlcErrors.forEach((errors, machineId) => {
      if (errors.length > 0) {
        onDataLoaded(machineId, errors);
        totalMlcErrors += errors.length;
      }
    });
    
    // Dispatch generic events to each machine
    let totalGenericEvents = 0;
    if (onEventsLoaded) {
      allGenericEvents.forEach((eventsByType, machineId) => {
        eventsByType.forEach((events, logType) => {
          if (events.length > 0) {
            onEventsLoaded(machineId, logType, events);
            totalGenericEvents += events.length;
          }
        });
      });
    }
    
    if (totalMlcErrors > 0 || totalGenericEvents > 0) {
      const parts = [];
      if (totalMlcErrors > 0) parts.push(`${totalMlcErrors} MLC errors`);
      if (totalGenericEvents > 0) parts.push(`${totalGenericEvents} other events`);
      toast.success(`Imported ${parts.join(', ')} from ${logFiles.length} file(s)`);
    } else if (totalBackupItems === 0) {
      toast.info('No events found in the scanned files');
    }
    
    setIsScanning(false);
    setProcessedCount(0);
  }, [processFile, processBackupFile, onDataLoaded, onEventsLoaded]);

  const selectFolder = useCallback(async () => {
    if (!isSupported) {
      toast.error('File System Access API is not supported in this browser');
      return;
    }

    if (isInIframe) {
      toast.error('Folder scanning requires the app to run in its own window. Click "Open in new tab" below.');
      return;
    }

    try {
      const handle = await (window as any).showDirectoryPicker({
        mode: 'read',
      });
      setDirectoryHandle(handle);
      knownFilesRef.current.clear();
      setScannedFiles([]);
      toast.success(`Selected folder: ${handle.name}`);
      
      // Initial scan
      setIsScanning(true);
      const files = await scanDirectory(handle);
      setScannedFiles(files);
      await processNewFiles(handle, files, true);
      setIsScanning(false);
    } catch (error: any) {
      if (error.name === 'SecurityError') {
        toast.error('Security restriction: Open the app in a new window to use folder scanning.');
      } else if (error.name !== 'AbortError') {
        toast.error('Failed to select folder');
        console.error(error);
      }
      setIsScanning(false);
    }
  }, [isSupported, isInIframe, scanDirectory, processNewFiles]);

  const startWatching = useCallback(() => {
    if (!directoryHandle) return;

    setIsWatching(true);
    toast.success('Started watching folder for new files');

    // Poll every 10 seconds
    watchIntervalRef.current = setInterval(async () => {
      const files = await scanDirectory(directoryHandle);
      setScannedFiles(files);
      await processNewFiles(directoryHandle, files);
    }, 10000);
  }, [directoryHandle, scanDirectory, processNewFiles]);

  const stopWatching = useCallback(() => {
    if (watchIntervalRef.current) {
      clearInterval(watchIntervalRef.current);
      watchIntervalRef.current = null;
    }
    setIsWatching(false);
    toast.info('Stopped watching folder');
  }, []);

  const disconnect = useCallback(() => {
    stopWatching();
    setDirectoryHandle(null);
    setScannedFiles([]);
    knownFilesRef.current.clear();
  }, [stopWatching]);

  const manualRefresh = useCallback(async () => {
    if (directoryHandle) {
      setIsScanning(true);
      const files = await scanDirectory(directoryHandle);
      setScannedFiles(files);
      await processNewFiles(directoryHandle, files);
      setIsScanning(false);
      toast.success('Folder refreshed');
    }
  }, [directoryHandle, scanDirectory, processNewFiles]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchIntervalRef.current) {
        clearInterval(watchIntervalRef.current);
      }
    };
  }, []);

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
      <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-3">
        <p className="text-sm text-foreground">
          <strong>Folder scanning</strong> requires the app to run in its own browser window due to security restrictions.
        </p>
        <a
          href={window.location.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          <FolderOpen className="h-4 w-4" />
          Open in new tab to enable
        </a>
        <p className="text-xs text-muted-foreground">
          Alternatively, use the file upload options to manually select log files.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 flex-wrap">
        {!directoryHandle ? (
          <Button onClick={selectFolder} variant="outline" className="gap-2">
            <FolderOpen className="h-4 w-4" />
            Select Folder to Scan
          </Button>
        ) : (
          <>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/50 rounded-md">
              <Folder className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{directoryHandle.name}</span>
              <Badge variant="outline" className="text-xs">
                {scannedFiles.length} files
              </Badge>
            </div>

            <Button
              onClick={manualRefresh}
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={isScanning}
            >
              {isScanning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>

            {isWatching ? (
              <Button
                onClick={stopWatching}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <Pause className="h-4 w-4" />
                Pause
              </Button>
            ) : (
              <Button
                onClick={startWatching}
                variant="default"
                size="sm"
                className="gap-2"
                disabled={isScanning}
              >
                <Play className="h-4 w-4" />
                Watch
              </Button>
            )}

            <Button
              onClick={disconnect}
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {/* File List */}
      {directoryHandle && scannedFiles.length > 0 && (
        <div className="max-h-32 overflow-y-auto space-y-1">
          {scannedFiles.slice(0, 10).map((file) => (
            <div
              key={file.path}
              className="flex items-center gap-2 px-2 py-1 text-xs bg-secondary/20 rounded"
            >
              <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              <span className="font-mono truncate flex-1">{file.path}</span>
              <span className="text-muted-foreground flex-shrink-0">
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </span>
            </div>
          ))}
          {scannedFiles.length > 10 && (
            <p className="text-xs text-muted-foreground px-2">
              ...and {scannedFiles.length - 10} more files
            </p>
          )}
        </div>
      )}

      {isScanning && processedCount > 0 && (
        <p className="text-xs text-muted-foreground">
          Processing file {processedCount}...
        </p>
      )}

      {isWatching && (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
          </span>
          Watching for new files every 10 seconds...
        </p>
      )}
    </div>
  );
}
