import { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react';
import { toast } from 'sonner';
import JSZip from 'jszip';
import { MLCError, MachineId, getMachineIds } from '@/data/mlcErrorData';
import { GenericEvent } from '@/data/genericEventData';
import { EventLogType, EVENT_LOG_TYPES, isAnyEventLogFile, detectLogTypeFromFilename } from '@/data/eventLogTypes';
import { parseXMLLogContent } from '@/lib/xmlLogParser';
import { parseGenericEventLog } from '@/lib/genericEventParser';
import { parseCombinedLogContent, isTxtLogFile, TabColumnFilter } from '@/lib/combinedLogParser';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { isTauriRuntime, tauriFs, tauriPath, TauriDirEntry } from '@/lib/tauriBridge';

// Extend the FileSystemDirectoryHandle type for async iteration
interface ExtendedFileSystemDirectoryHandle extends FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
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

type TauriApi = {
  fs?: {
    readDir?: (path: string, options?: { recursive?: boolean }) => Promise<Array<{ path?: string; name?: string; children?: unknown[] }>>;
    readTextFile?: (path: string) => Promise<string>;
    readBinaryFile?: (path: string) => Promise<Uint8Array>;
  };
};

/**
 * Retrieves data for `getTauriApi`.
 *
 * @param args Function input.
 * @returns Retrieved value.
 */
const getTauriApi = (): TauriApi | null => {
  const runtime = window as unknown as { __TAURI__?: TauriApi };
  return runtime.__TAURI__ ?? null;
};

// Centralised CombinedLog filter policy
const COMBINED_LOG_FILTERS: TabColumnFilter[] = [
  { columnIndex: 6, includeAny: ['COL', 'STN', 'SPV', 'BGM', 'CCHU', 'XI'] },
  { columnIndex: 7, includeAny: ['Fault'] },
  { columnIndex: 8, includeAny: ['raise', 'heartbeat', 'assert'] },
  { columnIndex: 0, exclude: ['1970'] },
  { columnIndex: 5, exclude: ['HAL-CR*', 'HAL_TRT*', 'webservicehost'] },
  { columnIndex: 6, exclude: ['CR', 'OSM.AppEvents'] },
  { columnIndex: 7, exclude: ['Controller', 'Coordinator', 'HardwareAPI', 'Interlock', 'General'] },
  { columnIndex: 8, exclude: ['ack', 'Warning', 'release', '1003', '1004', '1005', '1013', '2006', 'Prepare'] },
];


interface BackupDataV1 {
  version: 1;
  exportDate: string;
  machines: Record<string, {
    errors: Array<Record<string, unknown>>;
    replacements: Array<Record<string, unknown>>;
    events: Record<string, Array<Record<string, unknown>>>;
  }>;
}

interface BackupDataV2 {
  version: 2;
  exportDate: string;
  machines: Record<string, {
    events: Array<{
      id: string;
      timestamp: string;
      machineSerial: string;
      logType: string;
      eventCode: string;
      component: string;
      description: string;
      severity: string;
      rawData?: Record<string, string>;
      mlcMotor?: number | null;
      errorPosition?: number | null;
      bank?: string | null;
      count?: number | null;
      min?: number | null;
      max?: number | null;
      avg?: number | null;
    }>;
    replacements?: Array<Record<string, unknown>>;
  }>;
}


interface LegacyMachineExport {
  machineId?: string;
  rawErrors?: Array<Record<string, unknown>>;
  processedErrors?: Array<Record<string, unknown>>;
  replacements?: Array<Record<string, unknown>>;
  events?: Record<string, Array<Record<string, unknown>>>;
}


interface DesktopAutoScanFileResult {
  path: string;
  restoredItems: number;
  status?: 'restored' | 'schema_mismatch' | 'read_error';
  detail?: string;
}

interface DesktopAutoScanReport {
  ranAt: string;
  configuredPath: string;
  scannedJsonFiles: number;
  processedJsonFiles: number;
  restoredItems: number;
  latestJsonModifiedAt: string | null;
  files: DesktopAutoScanFileResult[];
  scanError?: string;
  skippedReason?: 'callbacks_not_registered' | 'no_new_or_modified_files' | 'parse_error';
}

const COMBINED_PROCESSOR_LAST_RUN_FILENAME = 'last_runCombinedprocessor.txt';

/**
 * Executes `formatUnknownError`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

interface UploadContextType {
  // Folder scanner state
  directoryHandle: FileSystemDirectoryHandle | null;
  isScanning: boolean;
  isWatching: boolean;
  scannedFiles: ScannedFile[];
  processedCount: number;
  desktopAutoScanReport: DesktopAutoScanReport | null;
  
  // Actions
  selectFolder: () => Promise<void>;
  startWatching: () => void;
  stopWatching: () => void;
  disconnect: () => void;
  manualRefresh: () => Promise<void>;
  runDesktopAutoScanNow: (options?: { forceReprocessKnown?: boolean }) => Promise<void>;
  importDesktopBackupJsonFile: (file: File) => Promise<number>;
  
  // Callbacks registration
  registerCallbacks: (
    onDataLoaded: (machineId: MachineId, errors: MLCError[]) => void,
    onEventsLoaded: (machineId: MachineId, logType: EventLogType, events: GenericEvent[]) => void,
    onReplacementsLoaded?: (machineId: MachineId, replacements: any[]) => void
  ) => void;
  
  // Support check
  isSupported: boolean;
  isInIframe: boolean;
}

const UploadContext = createContext<UploadContextType | null>(null);

/**
 * Provides the `useUpload` hook.
 *
 * @returns Hook state and actions.
 */
export const useUpload = () => {
  const context = useContext(UploadContext);
  if (!context) {
    throw new Error('useUpload must be used within UploadProvider');
  }
  return context;
};

// Robust ZIP parser
async function processZipFileRobust(file: File | Blob): Promise<ProcessedData> {
  const mlcErrors = new Map<MachineId, MLCError[]>();
  const genericEvents = new Map<MachineId, Map<EventLogType, GenericEvent[]>>();
  
  getMachineIds().forEach(id => {
    mlcErrors.set(id, []);
    genericEvents.set(id, new Map());
  });
  
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const promises: Promise<void>[] = [];

  zip.forEach((relativePath, zipEntry) => {
    if (zipEntry.dir) return;

    const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

    if (normalizedPath.startsWith('__macosx/')) return;

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
    } else if (normalizedPath.includes('eventlog') && normalizedPath.endsWith('.xml')) {
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
    } else if (normalizedPath.endsWith('.txt')) {
      promises.push(
        zipEntry.async('text').then(content => {
          try {
            const result = parseCombinedLogContent(content, relativePath, 'HAL2106', COMBINED_LOG_FILTERS);
            result.mlcErrors.forEach(error => {
              const machineId = error.machineSerial as MachineId;
              if (!mlcErrors.has(machineId)) mlcErrors.set(machineId, []);
              mlcErrors.get(machineId)!.push(error);
            });
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

interface UploadProviderProps {
  children: ReactNode;
}

/**
 * Renders the `UploadProvider` provider.
 *
 * @param props Provider props.
 * @returns Provider element.
 */
export const UploadProvider = ({ children }: UploadProviderProps) => {
  const { config } = useAppConfig();
  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isWatching, setIsWatching] = useState(false);
  const [scannedFiles, setScannedFiles] = useState<ScannedFile[]>([]);
  const [processedCount, setProcessedCount] = useState(0);
  const [desktopAutoScanReport, setDesktopAutoScanReport] = useState<DesktopAutoScanReport | null>(null);

  const getLatestJsonModifiedIso = useCallback((files: ScannedFile[]) => {
    const validModifiedTimes = files
      .map((file) => Number(file.lastModified))
      .filter((modifiedAt) => Number.isFinite(modifiedAt) && modifiedAt > 0);

    if (validModifiedTimes.length === 0) return null;
    return new Date(Math.max(...validModifiedTimes)).toISOString();
  }, []);

  const parseLastRunIso = useCallback((raw: string): string | null => {
    const match = raw.match(/last\s*run\s*:\s*(.+)$/im);
    const value = (match?.[1] || '').trim();
    if (!value) return null;

    const isoLike = value.replace(/\s+/, 'T');
    const parsedIsoLike = Date.parse(isoLike);
    if (Number.isFinite(parsedIsoLike)) return new Date(parsedIsoLike).toISOString();

    const timestampMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!timestampMatch) return null;

    const [, year, month, day, hour, minute, second] = timestampMatch;
    const parsedLocal = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second || '0'),
    ).getTime();
    return Number.isFinite(parsedLocal) ? new Date(parsedLocal).toISOString() : null;
  }, []);

  const getCombinedProcessorLastRunIso = useCallback(async (configuredPath: string): Promise<string | null> => {
    if (!configuredPath.trim()) return null;
    try {
      const markerPath = await tauriPath.join(configuredPath, COMBINED_PROCESSOR_LAST_RUN_FILENAME);
      const raw = await tauriFs.readTextFile(markerPath);
      return parseLastRunIso(raw);
    } catch {
      return null;
    }
  }, [parseLastRunIso]);
  
  const watchIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const knownFilesRef = useRef<Map<string, number>>(new Map());
  const callbacksRef = useRef<{
    onDataLoaded: ((machineId: MachineId, errors: MLCError[]) => void) | null;
    onEventsLoaded: ((machineId: MachineId, logType: EventLogType, events: GenericEvent[]) => void) | null;
    onReplacementsLoaded: ((machineId: MachineId, replacements: any[]) => void) | null;
  }>({ onDataLoaded: null, onEventsLoaded: null, onReplacementsLoaded: null });

  const isSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  /**
   * Evaluates whether `isInIframe` conditions are met.
   *
   * @param args Function input.
   * @returns Boolean evaluation result.
   */
  const isInIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();

  const sanitizeConfiguredPath = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';

    const withoutDoubleQuotes =
      trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1).trim() : trimmed;
    const withoutQuotes =
      withoutDoubleQuotes.startsWith("'") && withoutDoubleQuotes.endsWith("'")
        ? withoutDoubleQuotes.slice(1, -1).trim()
        : withoutDoubleQuotes;

    return withoutQuotes;
  }, []);

  const buildPathCandidates = useCallback((value: string) => {
    const cleaned = sanitizeConfiguredPath(value);
    if (!cleaned) return [];

    const candidates = new Set<string>();
    candidates.add(cleaned);

    const slash = cleaned.replace(/\\/g, '/');
    const backslash = cleaned.replace(/\//g, '\\');
    candidates.add(slash);
    candidates.add(backslash);

    if (cleaned.startsWith('\\\\')) {
      candidates.add(`//${cleaned.slice(2)}`);
    }
    if (cleaned.startsWith('//')) {
      candidates.add(`\\\\${cleaned.slice(2)}`);
    }

    return Array.from(candidates).filter((item) => item.length > 0);
  }, [sanitizeConfiguredPath]);

  const registerCallbacks = useCallback((
    onDataLoaded: (machineId: MachineId, errors: MLCError[]) => void,
    onEventsLoaded: (machineId: MachineId, logType: EventLogType, events: GenericEvent[]) => void,
    onReplacementsLoaded?: (machineId: MachineId, replacements: any[]) => void
  ) => {
    callbacksRef.current = { onDataLoaded, onEventsLoaded, onReplacementsLoaded: onReplacementsLoaded || null };
  }, []);

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

          if (file.name.toLowerCase().endsWith('.zip') || 
              isAnyEventLogFile(lowerPath) || 
              isTxtLogFile(file.name) ||
              file.name.toLowerCase().endsWith('.json')) {
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
        const txtResult = parseCombinedLogContent(content, fileName, 'HAL2106', COMBINED_LOG_FILTERS);
        txtResult.mlcErrors.forEach(error => {
          const machineId = error.machineSerial as MachineId;
          result.mlcErrors.get(machineId)?.push(error);
        });
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

  const scanTauriDirectory = useCallback(async (rootPath: string): Promise<ScannedFile[]> => {
    if (!isTauriRuntime()) return [];

    const candidates = buildPathCandidates(rootPath);
    let lastError: unknown = null;
    const candidateErrors: Array<{ candidatePath: string; error: string }> = [];

    for (const candidatePath of candidates) {
      try {
        const entries = await tauriFs.readDir(candidatePath, true);
      const files: ScannedFile[] = [];

        /**
         * Executes `walk`.
         *
         * @param args Function input.
         * @returns Execution result.
         */
        const walk = async (list: TauriDirEntry[], parentPath: string = candidatePath) => {
        for (const entry of list) {
          const name = String(entry.name || '').trim();
          const fullPath = String(entry.path || (name ? `${parentPath}/${name}` : parentPath)).trim();

          if (Array.isArray(entry.children) && entry.children.length > 0) {
            await walk(entry.children, fullPath);
            continue;
          }

          const lower = fullPath.toLowerCase();
          const fileName = name || fullPath.split(/[\\/]/).pop() || '';
          if (!fullPath || !fileName) continue;

          if (lower.endsWith('.zip') || lower.endsWith('.json') || isTxtLogFile(fileName) || isAnyEventLogFile(lower)) {
            const modifiedAt = await tauriFs.getModifiedAt(fullPath);
            files.push({ name: fileName, path: fullPath, lastModified: modifiedAt ?? 0, size: 0 });
          }
        }
      };

        await walk(entries);
        return files;
      } catch (error) {
        lastError = error;
        candidateErrors.push({
          candidatePath,
          error: formatUnknownError(error),
        });
      }
    }

    const detail = candidateErrors
      .map(({ candidatePath, error }) => `${candidatePath} => ${error}`)
      .join(' | ');

    const combinedError = detail || formatUnknownError(lastError);
    console.error(`Failed to read Tauri directory: ${rootPath}`, { lastError, candidateErrors });
    throw new Error(
      `Failed to scan configured database directory: ${rootPath}. ` +
      `Check UNC formatting and Tauri fs scope permissions. ` +
      `Tried candidates: ${combinedError}`
    );
  }, [buildPathCandidates]);

  const processBackupPayload = useCallback((payload: { version?: number; machines?: Record<string, unknown> } & LegacyMachineExport): number => {
    let totalItems = 0;
    const raw = payload;

    if (raw.version && raw.machines) {
      if (raw.version === 2) {
        const backup = raw as BackupDataV2;
        const mlcEventsByMachine = new Map<MachineId, MLCError[]>();
        const otherEventsByMachine = new Map<MachineId, GenericEvent[]>();

        getMachineIds().forEach((machineId) => {
          mlcEventsByMachine.set(machineId, []);
          otherEventsByMachine.set(machineId, []);
        });

        Object.entries(backup.machines).forEach(([machineId, data]) => {
          const id = machineId as MachineId;

          (data.events || []).forEach((evt) => {
            const ts = new Date(evt.timestamp);
            /**
             * Executes `eventMachineId`.
             *
             * @param args Function input.
             * @returns Execution result.
             */
            const eventMachineId = (evt.machineSerial || id) as MachineId;

            if (!mlcEventsByMachine.has(eventMachineId)) mlcEventsByMachine.set(eventMachineId, []);
            if (!otherEventsByMachine.has(eventMachineId)) otherEventsByMachine.set(eventMachineId, []);

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
              let groupedLogType: EventLogType = 'Other';
              const rawLogType = evt.logType?.trim() || '';
              const upper = rawLogType.split('.')[0].toUpperCase();
              if (upper === 'COL') groupedLogType = 'COL';
              else if (upper === 'MLC') groupedLogType = 'MLC';
              else if (upper === 'BEAM' || upper === 'BGM') groupedLogType = 'Beam';
              else if (upper === 'MOTION' || upper === 'STN') groupedLogType = 'Motion';
              else if (upper === 'IMAGE' || upper === 'XI') groupedLogType = 'Image';
              else if (EVENT_LOG_TYPES.includes(rawLogType as EventLogType)) groupedLogType = rawLogType as EventLogType;

              otherEventsByMachine.get(eventMachineId)?.push({
                id: evt.id,
                timestamp: ts,
                machineSerial: eventMachineId,
                logType: rawLogType || groupedLogType,
                eventCode: evt.eventCode,
                component: evt.component,
                description: evt.description,
                severity: evt.severity as GenericEvent['severity'],
                rawData: {
                  ...(evt.rawData || {}),
                  groupedLogType,
                },
                count: evt.count ?? null,
                min: evt.min ?? null,
                max: evt.max ?? null,
                avg: evt.avg ?? null,
              });
            }
          });

          if (data.replacements && data.replacements.length > 0 && callbacksRef.current.onReplacementsLoaded) {
            const replacements = data.replacements.map((r: any) => ({
              ...r,
              replacementDate: new Date(r.replacementDate),
            }));
            callbacksRef.current.onReplacementsLoaded(id, replacements);
            totalItems += replacements.length;
          }
        });

        mlcEventsByMachine.forEach((mlcEvents, machineId) => {
          if (mlcEvents.length > 0 && callbacksRef.current.onDataLoaded) {
            callbacksRef.current.onDataLoaded(machineId, mlcEvents);
            totalItems += mlcEvents.length;
          }
        });

        otherEventsByMachine.forEach((otherEvents, machineId) => {
          const byType = new Map<EventLogType, GenericEvent[]>();
          otherEvents.forEach((ev) => {
            const groupedLogType = (ev.rawData?.groupedLogType as EventLogType | undefined) || 'Other';
            const arr = byType.get(groupedLogType) || [];
            arr.push(ev);
            byType.set(groupedLogType, arr);
          });
          byType.forEach((events, logType) => {
            callbacksRef.current.onEventsLoaded?.(machineId, logType, events);
            totalItems += events.length;
          });
        });
      } else {
        const backup = raw as BackupDataV1;
        Object.entries(backup.machines).forEach(([machineId, data]) => {
          const id = machineId as MachineId;

          if (data.errors?.length > 0 && callbacksRef.current.onDataLoaded) {
            const errors = data.errors.map((e: any) => ({ ...e, timestamp: new Date(e.timestamp) }));
            callbacksRef.current.onDataLoaded(id, errors);
            totalItems += errors.length;
          }

          if (data.replacements?.length > 0 && callbacksRef.current.onReplacementsLoaded) {
            const replacements = data.replacements.map((r: any) => ({ ...r, replacementDate: new Date(r.replacementDate) }));
            callbacksRef.current.onReplacementsLoaded(id, replacements);
            totalItems += replacements.length;
          }

          if (data.events) {
            Object.entries(data.events).forEach(([logType, events]) => {
              if (!EVENT_LOG_TYPES.includes(logType as EventLogType)) return;
              if (!Array.isArray(events) || events.length === 0) return;
              const parsed: GenericEvent[] = events.map((e: any) => ({ ...e, timestamp: new Date(e.timestamp) }));
              callbacksRef.current.onEventsLoaded?.(id, logType as EventLogType, parsed);
              totalItems += parsed.length;
            });
          }
        });
      }
    } else if (raw.machineId) {
      const id = raw.machineId as MachineId;

      const sourceErrors = Array.isArray(raw.processedErrors) && raw.processedErrors.length > 0
        ? raw.processedErrors
        : Array.isArray(raw.rawErrors)
          ? raw.rawErrors
          : [];

      if (sourceErrors.length > 0 && callbacksRef.current.onDataLoaded) {
        const errors = sourceErrors.map((e: any) => ({ ...e, timestamp: new Date(e.timestamp) }));
        callbacksRef.current.onDataLoaded(id, errors);
        totalItems += errors.length;
      }

      if (Array.isArray(raw.replacements) && raw.replacements.length > 0 && callbacksRef.current.onReplacementsLoaded) {
        const replacements = raw.replacements.map((r: any) => ({ ...r, replacementDate: new Date(r.replacementDate) }));
        callbacksRef.current.onReplacementsLoaded(id, replacements);
        totalItems += replacements.length;
      }

      if (raw.events && typeof raw.events === 'object') {
        Object.entries(raw.events).forEach(([logType, events]) => {
          if (!EVENT_LOG_TYPES.includes(logType as EventLogType)) return;
          if (!Array.isArray(events) || events.length === 0) return;
          const parsed: GenericEvent[] = events.map((e: any) => ({ ...e, timestamp: new Date(e.timestamp) }));
          callbacksRef.current.onEventsLoaded?.(id, logType as EventLogType, parsed);
          totalItems += parsed.length;
        });
      }
    }

    return totalItems;
  }, []);

  const readAndParseTauriJsonFile = useCallback(async (filePath: string) => {
    /**
     * Parses input data in `parsePayload`.
     *
     * @param args Function input.
     * @returns Parsed result.
     */
    const parsePayload = (text: string) => JSON.parse(text.replace(/^\uFEFF/, '')) as { version?: number; machines?: Record<string, unknown> } & LegacyMachineExport;

    try {
      const text = await tauriFs.readTextFile(filePath);
      return parsePayload(text);
    } catch (textReadError) {
      try {
        const bytes = await tauriFs.readBinaryFile(filePath);
        const decoders = [new TextDecoder('utf-8'), new TextDecoder('utf-16le'), new TextDecoder('utf-16be')];
        let lastParseError: unknown = textReadError;

        for (const decoder of decoders) {
          try {
            return parsePayload(decoder.decode(new Uint8Array(bytes)));
          } catch (parseError) {
            lastParseError = parseError;
          }
        }

        throw lastParseError;
      } catch (binaryReadError) {
        throw binaryReadError;
      }
    }
  }, []);

  const processTauriBackupFile = useCallback(async (filePath: string): Promise<DesktopAutoScanFileResult> => {
    if (!isTauriRuntime()) return { path: filePath, restoredItems: 0, status: 'read_error', detail: 'not_tauri_runtime' };

    try {
      const raw = await readAndParseTauriJsonFile(filePath);
      const restoredItems = processBackupPayload(raw);
      if (!raw.version && !raw.machines && !raw.machineId) {
        return { path: filePath, restoredItems, status: 'schema_mismatch', detail: 'missing version/machines or machineId root keys' };
      }
      return { path: filePath, restoredItems, status: restoredItems > 0 ? 'restored' : 'schema_mismatch' };
    } catch (error) {
      console.error(`Failed to process Tauri backup file ${filePath}:`, error);
      return { path: filePath, restoredItems: 0, status: 'read_error', detail: String(error) };
    }
  }, [processBackupPayload, readAndParseTauriJsonFile]);

  const importDesktopBackupJsonFile = useCallback(async (file: File): Promise<number> => {
    try {
      const content = await file.text();
      const raw = JSON.parse(content.replace(/^﻿/, '')) as { version?: number; machines?: Record<string, unknown> } & LegacyMachineExport;
      const restored = processBackupPayload(raw);
      const report: DesktopAutoScanReport = {
        ranAt: new Date().toISOString(),
        configuredPath: `manual-upload:${file.name}`,
        scannedJsonFiles: 1,
        processedJsonFiles: 1,
        restoredItems: restored,
        latestJsonModifiedAt: new Date(file.lastModified).toISOString(),
        files: [{ path: file.name, restoredItems: restored }],
      };
      setDesktopAutoScanReport(report);
      return restored;
    } catch (error) {
      console.error(`Failed to import desktop backup JSON ${file.name}:`, error);
      setDesktopAutoScanReport({
        ranAt: new Date().toISOString(),
        configuredPath: `manual-upload:${file.name}`,
        scannedJsonFiles: 1,
        processedJsonFiles: 1,
        restoredItems: 0,
        latestJsonModifiedAt: new Date(file.lastModified).toISOString(),
        files: [{ path: file.name, restoredItems: 0 }],
        skippedReason: 'parse_error',
      });
      return 0;
    }
  }, [processBackupPayload]);



  // Process a backup JSON file
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
        const backup = raw as BackupDataV2;
        Object.entries(backup.machines).forEach(([machineId, data]) => {
            // Accept any machine ID from backup
          const id = machineId as MachineId;

          const mlcEvents: MLCError[] = [];
          const otherEvents: GenericEvent[] = [];

          (data.events || []).forEach((evt) => {
            const ts = new Date(evt.timestamp);

            if (evt.logType === 'MLC' && evt.mlcMotor != null && evt.bank) {
              mlcEvents.push({
                timestamp: ts,
                machineSerial: evt.machineSerial,
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
              let groupedLogType: EventLogType = 'Other';
              const rawLogType = String(evt.logType || '').trim();
              const prefix = rawLogType.split('.')[0].toUpperCase();
              if (prefix === 'COL') groupedLogType = 'COL';
              else if (prefix === 'MLC') groupedLogType = 'MLC';
              else if (prefix === 'BGM' || prefix === 'BEAM') groupedLogType = 'Beam';
              else if (prefix === 'STN' || prefix === 'MOTION') groupedLogType = 'Motion';
              else if (prefix === 'XI' || prefix === 'IMAGE') groupedLogType = 'Image';
              else if (EVENT_LOG_TYPES.includes(rawLogType as EventLogType)) groupedLogType = rawLogType as EventLogType;

              otherEvents.push({
                id: evt.id,
                timestamp: ts,
                machineSerial: id,
                logType: rawLogType || groupedLogType,
                eventCode: evt.eventCode,
                component: evt.component,
                description: evt.description,
                severity: evt.severity as GenericEvent['severity'],
                rawData: {
                  ...(evt.rawData || {}),
                  groupedLogType,
                },
                count: evt.count ?? undefined,
                min: evt.min ?? undefined,
                max: evt.max ?? undefined,
                avg: evt.avg ?? undefined,
              });
            }
          });

          if (mlcEvents.length > 0 && callbacksRef.current.onDataLoaded) {
            callbacksRef.current.onDataLoaded(id, mlcEvents);
            totalItems += mlcEvents.length;
          }

          const byType = new Map<EventLogType, GenericEvent[]>();
          otherEvents.forEach((ev) => {
            const groupedLogType = (ev.rawData?.groupedLogType as EventLogType | undefined) || 'Other';
            const arr = byType.get(groupedLogType) || [];
            arr.push(ev);
            byType.set(groupedLogType, arr);
          });
          byType.forEach((events, logType) => {
            callbacksRef.current.onEventsLoaded?.(id, logType, events);
            totalItems += events.length;
          });

          if (data.replacements && data.replacements.length > 0 && callbacksRef.current.onReplacementsLoaded) {
            const replacements = data.replacements.map((r: any) => ({
              ...r,
              replacementDate: new Date(r.replacementDate),
            }));
            callbacksRef.current.onReplacementsLoaded(id, replacements);
            totalItems += replacements.length;
          }
        });
      } else {
        const backup = raw as BackupDataV1;
        Object.entries(backup.machines).forEach(([machineId, data]) => {
          // Accept any machine ID from backup
          const id = machineId as MachineId;

          if (data.errors?.length > 0 && callbacksRef.current.onDataLoaded) {
            const errors = data.errors.map((e: any) => ({ ...e, timestamp: new Date(e.timestamp) }));
            callbacksRef.current.onDataLoaded(id, errors);
            totalItems += errors.length;
          }

          if (data.replacements?.length > 0 && callbacksRef.current.onReplacementsLoaded) {
            const replacements = data.replacements.map((r: any) => ({ ...r, replacementDate: new Date(r.replacementDate) }));
            callbacksRef.current.onReplacementsLoaded(id, replacements);
            totalItems += replacements.length;
          }

          if (data.events) {
            Object.entries(data.events).forEach(([logType, events]) => {
              if (!EVENT_LOG_TYPES.includes(logType as EventLogType)) return;
              if (!Array.isArray(events) || events.length === 0) return;
              const parsed: GenericEvent[] = events.map((e: any) => ({ ...e, timestamp: new Date(e.timestamp) }));
              callbacksRef.current.onEventsLoaded?.(id, logType as EventLogType, parsed);
              totalItems += parsed.length;
            });
          }
        });
      }

      if (totalItems > 0) {
        toast.success(`Restored backup: ${totalItems} items`);
      }
    } catch (err) {
      console.error(`Failed to process backup file ${filePath}:`, err);
    }
    return totalItems;
  }, []);

  const processNewFiles = useCallback(async (
    handle: FileSystemDirectoryHandle,
    files: ScannedFile[],
    isInitial: boolean = false
  ) => {
    const newFiles = files.filter(file => {
      const knownModified = knownFilesRef.current.get(file.path);
      return !knownModified || knownModified < file.lastModified;
    });
    
    if (newFiles.length === 0 && !isInitial) return;
    
    files.forEach(file => {
      knownFilesRef.current.set(file.path, file.lastModified);
    });
    
    if (newFiles.length === 0) return;
    
    setIsScanning(true);
    toast.info(`Processing ${newFiles.length} new/modified file(s)...`);

    // Separate backup JSON files from regular log files
    const backupFiles = newFiles.filter(f => f.name.toLowerCase().endsWith('.json'));
    const logFiles = newFiles.filter(f => !f.name.toLowerCase().endsWith('.json'));

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
    
    // Dispatch to callbacks
    let totalMlcErrors = 0;
    allMlcErrors.forEach((errors, machineId) => {
      if (errors.length > 0 && callbacksRef.current.onDataLoaded) {
        callbacksRef.current.onDataLoaded(machineId, errors);
        totalMlcErrors += errors.length;
      }
    });
    
    let totalGenericEvents = 0;
    allGenericEvents.forEach((eventsByType, machineId) => {
      eventsByType.forEach((events, logType) => {
        if (events.length > 0 && callbacksRef.current.onEventsLoaded) {
          callbacksRef.current.onEventsLoaded(machineId, logType, events);
          totalGenericEvents += events.length;
        }
      });
    });
    
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
  }, [processFile, processBackupFile]);

  const selectFolder = useCallback(async () => {
    if (!isSupported) {
      toast.error('File System Access API is not supported in this browser');
      return;
    }

    if (isInIframe) {
      toast.error('Folder scanning requires the app to run in its own window.');
      return;
    }

    try {
      const runtime = window as unknown as { showDirectoryPicker: (opts: { mode: string }) => Promise<FileSystemDirectoryHandle> };
      const handle = await runtime.showDirectoryPicker({ mode: 'read' });
      setDirectoryHandle(handle);
      knownFilesRef.current.clear();
      setScannedFiles([]);
      toast.success(`Selected folder: ${handle.name}`);
      
      setIsScanning(true);
      const files = await scanDirectory(handle);
      setScannedFiles(files);
      await processNewFiles(handle, files, true);
      setIsScanning(false);
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === 'SecurityError') {
        toast.error('Security restriction: Open the app in a new window to use folder scanning.');
      } else if (err.name !== 'AbortError') {
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

    watchIntervalRef.current = setInterval(async () => {
      const files = await scanDirectory(directoryHandle);
      setScannedFiles(files);
      await processNewFiles(directoryHandle, files);
    }, 10000);
  }, [directoryHandle, scanDirectory, processNewFiles]);

  const runTauriDirectoryScan = useCallback(async (path: string, options?: { forceReprocessKnown?: boolean }) => {
    let files: ScannedFile[] = [];
    try {
      files = await scanTauriDirectory(path);
    } catch (error) {
      const scanError = formatUnknownError(error);
      setDesktopAutoScanReport({
        ranAt: new Date().toISOString(),
        configuredPath: path,
        scannedJsonFiles: 0,
        processedJsonFiles: 0,
        restoredItems: 0,
        latestJsonModifiedAt: null,
        files: [],
        scanError,
        skippedReason: 'parse_error',
      });
      toast.error(scanError);
      return;
    }

    setScannedFiles(files);

    const jsonFiles = files.filter((file) => file.name.toLowerCase().endsWith('.json'));
    const combinedProcessorLastRunIso = await getCombinedProcessorLastRunIso(path);
    const latestCombinedTimestampIso = combinedProcessorLastRunIso ?? getLatestJsonModifiedIso(jsonFiles);

    // Auto-scan can run before UI modules register callbacks; defer processing
    // so JSON files are not marked as seen and skipped forever.
    if (!callbacksRef.current.onDataLoaded || !callbacksRef.current.onEventsLoaded) {
      setDesktopAutoScanReport({
        ranAt: new Date().toISOString(),
        configuredPath: path,
        scannedJsonFiles: jsonFiles.length,
        processedJsonFiles: 0,
        restoredItems: 0,
        latestJsonModifiedAt: latestCombinedTimestampIso,
        files: [],
        skippedReason: 'callbacks_not_registered',
      });
      return;
    }

    const shouldForce = options?.forceReprocessKnown === true;
    const newFiles = shouldForce
      ? jsonFiles
      : jsonFiles.filter((file) => {
        const knownModified = knownFilesRef.current.get(file.path);
        return !knownModified || knownModified < file.lastModified;
      });
    files.forEach((file) => knownFilesRef.current.set(file.path, file.lastModified));
    if (newFiles.length === 0) {
      setDesktopAutoScanReport({
        ranAt: new Date().toISOString(),
        configuredPath: path,
        scannedJsonFiles: jsonFiles.length,
        processedJsonFiles: 0,
        restoredItems: 0,
        latestJsonModifiedAt: latestCombinedTimestampIso,
        files: [],
        skippedReason: 'no_new_or_modified_files',
      });
      return;
    }

    setIsScanning(true);
    let processed = 0;
    let restoredItems = 0;
      const fileResults: DesktopAutoScanFileResult[] = [];
      for (const file of newFiles) {
      const result = await processTauriBackupFile(file.path);
      restoredItems += result.restoredItems;
      fileResults.push(result);
      processed += 1;
      setProcessedCount(processed);
    }

    setDesktopAutoScanReport({
      ranAt: new Date().toISOString(),
      configuredPath: path,
      scannedJsonFiles: jsonFiles.length,
      processedJsonFiles: processed,
      restoredItems,
      latestJsonModifiedAt: latestCombinedTimestampIso,
      files: fileResults,
    });

    setIsScanning(false);
    setProcessedCount(0);
  }, [getCombinedProcessorLastRunIso, getLatestJsonModifiedIso, processTauriBackupFile, scanTauriDirectory]);

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

  useEffect(() => {
    return () => {
      if (watchIntervalRef.current) {
        clearInterval(watchIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const configuredPath = sanitizeConfiguredPath(config.databaseDirectory || '');
    if (!isTauriRuntime() || !configuredPath) return;

    knownFilesRef.current.clear();
    toast.info(`Desktop auto-scan enabled for: ${configuredPath}`);
    runTauriDirectoryScan(configuredPath).catch((error) => {
      console.error('Initial desktop auto-scan failed', error);
      toast.error('Initial desktop auto-scan failed');
    });
    setIsWatching(true);

    if (watchIntervalRef.current) clearInterval(watchIntervalRef.current);
    /**
     * Executes `startMinutePolling`.
     *
     * @param args Function input.
     * @returns Execution result.
     */
    const startMinutePolling = () => {
      if (watchIntervalRef.current) clearInterval(watchIntervalRef.current);
      watchIntervalRef.current = setInterval(() => {
        runTauriDirectoryScan(configuredPath).catch((error) => {
          console.error('Desktop watch scan failed', error);
        });
      }, 300000);
    };

    watchIntervalRef.current = setInterval(() => {
      runTauriDirectoryScan(configuredPath)
        .catch((error) => {
          console.error('Desktop watch scan failed', error);
        })
        .finally(() => {
          startMinutePolling();
        });
    }, 10000);

    return () => {
      if (watchIntervalRef.current) {
        clearInterval(watchIntervalRef.current);
        watchIntervalRef.current = null;
      }
      setIsWatching(false);
    };
  }, [config.databaseDirectory, runTauriDirectoryScan, sanitizeConfiguredPath]);


  const runDesktopAutoScanNow = useCallback(async (options?: { forceReprocessKnown?: boolean }) => {
    const configuredPath = sanitizeConfiguredPath(config.databaseDirectory || '');
    if (!isTauriRuntime() || !configuredPath) {
      toast.error('Desktop auto-scan is only available in Tauri with a configured directory');
      return;
    }
    await runTauriDirectoryScan(configuredPath, options);
  }, [config.databaseDirectory, runTauriDirectoryScan, sanitizeConfiguredPath]);

  const value: UploadContextType = {
    directoryHandle,
    isScanning,
    isWatching,
    scannedFiles,
    processedCount,
    desktopAutoScanReport,
    selectFolder,
    startWatching,
    stopWatching,
    disconnect,
    manualRefresh,
    runDesktopAutoScanNow,
    importDesktopBackupJsonFile,
    registerCallbacks,
    isSupported,
    isInIframe,
  };

  return (
    <UploadContext.Provider value={value}>
      {children}
    </UploadContext.Provider>
  );
};
