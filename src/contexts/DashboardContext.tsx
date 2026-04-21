import { createContext, useContext, useState, ReactNode, useMemo, useEffect, useRef, useCallback } from 'react';
import { subMonths, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { useMachineData } from '@/hooks/useMachineData';
import { useEventLogData, EventsByType } from '@/hooks/useEventLogData';
import { MLCError, MotorReplacement, MachineId, getMachineIds } from '@/data/mlcErrorData';
import { GenericEvent } from '@/data/genericEventData';
import { EventLogType, EVENT_LOG_TYPES } from '@/data/eventLogTypes';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { useUpload } from '@/contexts/UploadContext';
import { isTauriRuntime, tauriFs, tauriPath } from '@/lib/tauriBridge';
import { parseReplacementWorkbook } from '@/lib/replacementImport';
import { toast } from 'sonner';

interface ReplacementAutoImportReport {
  ranAt: string;
  configuredPath: string;
  status: 'imported' | 'no_valid_rows' | 'read_error' | 'skipped';
  totalCount: number;
  perMachine: Record<string, number>;
  error?: string;
}

interface DashboardContextType {
  // Machine data
  machineData: Record<string, { errors: MLCError[]; replacements: MotorReplacement[] }>;
  isLoaded: boolean;
  addErrors: (machineId: MachineId, errors: MLCError[]) => void;
  addReplacement: (machineId: MachineId, replacement: MotorReplacement) => void;
  addReplacements: (machineId: MachineId, replacements: MotorReplacement[]) => void;
  removeReplacement: (machineId: MachineId, replacementId: string) => void;
  clearMachineData: (machineId: MachineId) => void;
  clearAllData: () => void;
  groupingWindowSeconds: number;
  setGroupingWindowSeconds: (seconds: number) => void;
  getRawErrors: (machineId: MachineId) => MLCError[];
  
  // Event data
  eventData: Record<string, EventsByType>;
  eventsLoaded: boolean;
  addEvents: (machineId: MachineId, logType: EventLogType, events: GenericEvent[]) => void;
  clearEventData: (machineId: MachineId, logType?: EventLogType) => void;
  getEventsByType: (machineId: MachineId) => EventsByType;
  
  // Selection state
  selectedMachine: MachineId;
  setSelectedMachine: (id: MachineId) => void;
  
  // Date range
  dateRange: { from: Date; to: Date };
  setDateRange: (range: { from: Date; to: Date }) => void;
  
  // Filtered data based on date range
  filteredErrors: MLCError[];
  filteredEvents: EventsByType;
  
  // All timestamps for date range calculation
  allTimestamps: Date[];

  // Replacement auto-import diagnostics
  replacementAutoImportReport: ReplacementAutoImportReport | null;
  runReplacementAutoImportNow: () => Promise<void>;
  machineLastRunStatusByMachine: Record<string, { path: string; timestamp: string | null; checkedAt: string; error?: string }>;
}

const DashboardContext = createContext<DashboardContextType | null>(null);

/**
 * Provides the `useDashboard` hook.
 *
 * @returns Hook state and actions.
 */
export const useDashboard = () => {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within DashboardProvider');
  }
  return context;
};

interface DashboardProviderProps {
  children: ReactNode;
}

/**
 * Renders the `DashboardProvider` provider.
 *
 * @param props Provider props.
 * @returns Provider element.
 */
export const DashboardProvider = ({ children }: DashboardProviderProps) => {
  const machineHook = useMachineData();
  const eventHook = useEventLogData();
  const { config } = useAppConfig();
  const { registerCallbacks } = useUpload();
  
  const machineIds = getMachineIds();
  const [selectedMachine, setSelectedMachine] = useState<MachineId>(machineIds[0] || 'HAL2106');
  const [replacementAutoImportReport, setReplacementAutoImportReport] = useState<ReplacementAutoImportReport | null>(null);
  const [machineLastRunStatusByMachine, setMachineLastRunStatusByMachine] = useState<
    Record<string, { path: string; timestamp: string | null; checkedAt: string; error?: string }>
  >({});
  const lastReplacementSummaryRef = useRef<string>('');
  const lastReplacementErrorRef = useRef<string>('');

  useEffect(() => {
    registerCallbacks(machineHook.addErrors, eventHook.addEvents, machineHook.addReplacements);
  }, [registerCallbacks, machineHook.addErrors, eventHook.addEvents, machineHook.addReplacements]);

  const runReplacementImport = useCallback(async (options?: { showToastOnSuccess?: boolean }) => {
    const configuredPath = config.replacementsImportPath?.trim();
    if (!isTauriRuntime() || !configuredPath) {
      setReplacementAutoImportReport({
        ranAt: new Date().toISOString(),
        configuredPath: configuredPath || '(not configured)',
        status: 'skipped',
        totalCount: 0,
        perMachine: {},
        error: 'Replacement auto-import is only available in Tauri with a configured path.',
      });
      return;
    }

    try {
      const bytes = await tauriFs.readBinaryFile(configuredPath);

      const { replacementsByMachine, totalCount } = parseReplacementWorkbook(new Uint8Array(bytes));
      const perMachine = Object.fromEntries(
        Object.entries(replacementsByMachine).map(([machineId, replacements]) => [machineId, replacements.length]),
      );

      if (totalCount > 0) {
        Object.entries(replacementsByMachine).forEach(([machineId, replacements]) => {
          if (replacements.length > 0) {
            machineHook.addReplacements(machineId as MachineId, replacements);
          }
        });

        const summary = Object.entries(perMachine)
          .filter(([, count]) => count > 0)
          .map(([machineId, count]) => `${machineId}: ${count}`)
          .join(', ');

        if (summary && (options?.showToastOnSuccess || summary !== lastReplacementSummaryRef.current)) {
          toast.success(`Replacement auto-import: ${totalCount} rows (${summary})`);
        }
        lastReplacementSummaryRef.current = summary;
        lastReplacementErrorRef.current = '';
      } else if (options?.showToastOnSuccess) {
        toast.info('Replacement auto-import found no valid rows in the Excel file');
      }

      setReplacementAutoImportReport({
        ranAt: new Date().toISOString(),
        configuredPath,
        status: totalCount > 0 ? 'imported' : 'no_valid_rows',
        totalCount,
        perMachine,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('Failed to auto-import replacements from configured path:', error);
      setReplacementAutoImportReport({
        ranAt: new Date().toISOString(),
        configuredPath,
        status: 'read_error',
        totalCount: 0,
        perMachine: {},
        error: message,
      });

      if (message !== lastReplacementErrorRef.current) {
        toast.error(`Replacement auto-import failed: ${message}`);
      }
      lastReplacementErrorRef.current = message;
    }
  }, [config.replacementsImportPath, machineHook.addReplacements]);

  const runReplacementAutoImportNow = useCallback(async () => {
    await runReplacementImport({ showToastOnSuccess: true });
  }, [runReplacementImport]);

  const addReplacement = useCallback((machineId: MachineId, replacement: MotorReplacement) => {
    machineHook.addReplacement(machineId, replacement);
  }, [machineHook.addReplacement]);

  useEffect(() => {
    const configuredPath = config.replacementsImportPath?.trim();
    if (!isTauriRuntime() || !configuredPath) {
      setReplacementAutoImportReport(null);
      return;
    }

    toast.info(`Replacement auto-import enabled for: ${configuredPath}`);
    let cancelled = false;

    runReplacementImport({ showToastOnSuccess: true });
    const timer = window.setInterval(() => {
      if (cancelled) return;
      runReplacementImport();
    }, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [config.replacementsImportPath, runReplacementImport]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const nowIso = new Date().toISOString();
      const next: Record<string, { path: string; timestamp: string | null; checkedAt: string; error?: string }> = {};
      for (const machineId of config.machineIds) {
        const path = config.machineLastRunTxtPaths?.[machineId]?.trim() || '';
        if (!path) {
          next[machineId] = { path: '', timestamp: null, checkedAt: nowIso };
          continue;
        }
        if (!isTauriRuntime()) {
          next[machineId] = { path, timestamp: null, checkedAt: nowIso, error: 'Available in desktop (Tauri) mode only' };
          continue;
        }

        try {
          const raw = await tauriFs.readTextFile(path);
          const match = raw.match(/last\s*run\s*:\s*(.+)$/im);
          next[machineId] = {
            path,
            timestamp: (match?.[1] || '').trim() || null,
            checkedAt: nowIso,
            error: match ? undefined : 'Could not find "Last run:" pattern',
          };
        } catch (error) {
          next[machineId] = {
            path,
            timestamp: null,
            checkedAt: nowIso,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      if (!cancelled) {
        setMachineLastRunStatusByMachine(next);
      }
    };

    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [config.machineIds, config.machineLastRunTxtPaths]);
  
  // Calculate all timestamps from all events for selected machine
  const allTimestamps = useMemo(() => {
    const timestamps: Date[] = [];
    
    const machineErrors = machineHook.machineData[selectedMachine];
    if (machineErrors) {
      machineErrors.errors.forEach(e => {
        timestamps.push(e.timestamp);
      });
    }
    
    const eventsByType = eventHook.getEventsByType(selectedMachine);
    EVENT_LOG_TYPES.forEach(type => {
      eventsByType[type]?.forEach(e => {
        timestamps.push(e.timestamp);
      });
    });
    
    return timestamps;
  }, [machineHook.machineData, eventHook, selectedMachine]);
  
  // Initialize date range based on all events
  const [dateRange, setDateRange] = useState(() => {
    if (allTimestamps.length > 0) {
      const times = allTimestamps.map(t => t.getTime());
      return {
        from: new Date(Math.min(...times)),
        to: new Date(Math.max(...times)),
      };
    }
    return {
      from: subMonths(new Date(), 2),
      to: new Date(),
    };
  });
  
  // Filter MLC errors by date range
  const filteredErrors = useMemo(() => {
    const machineErrors = machineHook.machineData[selectedMachine];
    if (!machineErrors) return [];
    return machineErrors.errors.filter(error =>
      isWithinInterval(error.timestamp, {
        start: startOfDay(dateRange.from),
        end: endOfDay(dateRange.to),
      })
    );
  }, [dateRange, machineHook.machineData, selectedMachine]);
  
  // Filter all events by date range
  const filteredEvents = useMemo(() => {
    const eventsByType = eventHook.getEventsByType(selectedMachine);
    const result = {} as EventsByType;
    const excludedTerms = config.excludedEventTerms.map((term) => term.toLowerCase());

    EVENT_LOG_TYPES.forEach(type => {
      result[type] = (eventsByType[type] || []).filter(event => {
        const inDateRange = isWithinInterval(event.timestamp, {
          start: startOfDay(dateRange.from),
          end: endOfDay(dateRange.to),
        });
        if (!inDateRange) return false;

        if (excludedTerms.length === 0) return true;

        const searchable = [
          event.component,
          event.description,
          event.eventCode,
          event.logType,
          event.rawData?.fullMessage,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return !excludedTerms.some((term) => searchable.includes(term));
      });
    });

    return result;
  }, [config.excludedEventTerms, dateRange, eventHook, selectedMachine]);
  
  const value: DashboardContextType = {
    // Machine data
    machineData: machineHook.machineData,
    isLoaded: machineHook.isLoaded,
    addErrors: machineHook.addErrors,
    addReplacement,
    addReplacements: machineHook.addReplacements,
    removeReplacement: machineHook.removeReplacement,
    clearMachineData: machineHook.clearMachineData,
    clearAllData: () => {
      machineIds.forEach(id => {
        machineHook.clearMachineData(id);
        eventHook.clearEventData(id);
      });
    },
    groupingWindowSeconds: machineHook.groupingWindowSeconds,
    setGroupingWindowSeconds: machineHook.setGroupingWindowSeconds,
    getRawErrors: machineHook.getRawErrors,
    
    // Event data
    eventData: eventHook.eventData,
    eventsLoaded: eventHook.isLoaded,
    addEvents: eventHook.addEvents,
    clearEventData: eventHook.clearEventData,
    getEventsByType: eventHook.getEventsByType,
    
    // Selection
    selectedMachine,
    setSelectedMachine,
    
    // Date range
    dateRange,
    setDateRange,
    
    // Filtered data
    filteredErrors,
    filteredEvents,
    
    // All timestamps
    allTimestamps,

    // Replacements auto-import diagnostics
    replacementAutoImportReport,
    runReplacementAutoImportNow,
    machineLastRunStatusByMachine,
  };
  
  if (!machineHook.isLoaded || !eventHook.isLoaded) {
    return null;
  }
  
  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
};
