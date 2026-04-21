import { useState, useEffect, useCallback } from 'react';
import { 
  MLCError, 
  MotorReplacement, 
  MachineData, 
  MachineId, 
  getMachineIds,
  createEmptyMachineData,
  mergeErrors,
  processErrors,
} from '@/data/mlcErrorData';

const STORAGE_KEY = 'mlc-dashboard-data-v2';
const GROUPING_STORAGE_KEY = 'mlc-dashboard-grouping';

// Extended interface to store both raw and processed errors
interface ExtendedMachineData {
  rawErrors: MLCError[]; // Unprocessed errors (without isHardError flags)
  processedErrors: MLCError[]; // Processed errors (with isHardError flags)
  replacements: MotorReplacement[];
}

interface StoredData {
  machines: Record<string, {
    rawErrors: Array<{
      timestamp: string;
      machineSerial: string;
      errorCode: string;
      location: string;
      region: string;
      country: string;
      component: string;
      errorText: string;
      severity: string;
      mlcMotor: number;
      errorPosition: number;
      bank: 'A' | 'B';
    }>;
    replacements: Array<{
      id: string;
      machineSerial: string;
      mlcMotor: number;
      bank: 'A' | 'B';
      replacementDate: string;
      replacedBy: string;
      notes?: string;
    }>;
  }>;
}

/**
 * Removes derived processing flags before persisting raw errors.
 *
 * @param error Processed error.
 * @returns Error without transient processing flags.
 */
const stripProcessingFlags = (error: MLCError): MLCError => ({
  ...error,
  isHardError: undefined,
  isMotorReplacement: undefined,
  groupedCount: undefined,
});

/**
 * Serializes machine data for localStorage persistence.
 *
 * @param machines In-memory machine data.
 * @returns JSON-safe payload.
 */
const serializeMachineData = (machines: Record<string, ExtendedMachineData>): StoredData => {
  const result: StoredData = { machines: {} };
  
  Object.keys(machines).forEach(id => {
    result.machines[id] = {
      rawErrors: machines[id].rawErrors.map(e => ({
        ...stripProcessingFlags(e),
        timestamp: e.timestamp.toISOString(),
      })),
      replacements: machines[id].replacements.map(r => ({
        ...r,
        replacementDate: r.replacementDate.toISOString(),
      })),
    };
  });
  
  return result;
};

/**
 * Deserializes persisted machine data and rebuilds processed errors.
 *
 * @param stored Persisted payload.
 * @param groupingWindowSeconds Grouping window used to derive processed errors.
 * @returns In-memory machine data state.
 */
const deserializeMachineData = (
  stored: StoredData, 
  groupingWindowSeconds: number
): Record<string, ExtendedMachineData> => {
  const machineIds = getMachineIds();
  const result: Record<string, ExtendedMachineData> = {};
  
  // Initialize all configured machine IDs
  machineIds.forEach(id => {
    result[id] = createEmptyExtendedMachineData();
  });

  // Load stored data (including any machine IDs that might not be in current config)
  Object.keys(stored.machines).forEach(id => {
    const data = stored.machines[id];
    if (data) {
      const rawErrors = data.rawErrors.map(e => ({
        ...e,
        timestamp: new Date(e.timestamp),
      }));
      const replacements = data.replacements.map(r => ({
        ...r,
        replacementDate: new Date(r.replacementDate),
      }));
      const processedErrors = processErrors(rawErrors, replacements, groupingWindowSeconds);
      
      result[id] = {
        rawErrors,
        processedErrors,
        replacements,
      };
    }
  });
  
  return result;
};

/**
 * Creates an empty extended machine-data container.
 *
 * @returns Empty extended machine data.
 */
const createEmptyExtendedMachineData = (): ExtendedMachineData => ({
  rawErrors: [],
  processedErrors: [],
  replacements: [],
});

/**
 * Creates initial machine data for all configured machine IDs.
 *
 * @returns Machine-keyed empty data record.
 */
const createInitialData = (): Record<string, ExtendedMachineData> => {
  const result: Record<string, ExtendedMachineData> = {};
  getMachineIds().forEach(id => {
    result[id] = createEmptyExtendedMachineData();
  });
  return result;
};

/**
 * Migrates legacy v1 storage schema to the current v2 format.
 *
 * @param groupingWindowSeconds Grouping window used for reprocessing migrated errors.
 * @returns Migrated data, or `null` when no migration source exists.
 */
const migrateFromOldFormat = (groupingWindowSeconds: number): Record<string, ExtendedMachineData> | null => {
  try {
    const oldStored = localStorage.getItem('mlc-dashboard-data');
    if (!oldStored) return null;
    
    const oldData = JSON.parse(oldStored);
    const result: Record<string, ExtendedMachineData> = {};
    
    // Initialize with current config
    getMachineIds().forEach(id => {
      result[id] = createEmptyExtendedMachineData();
    });

    Object.keys(oldData.machines || {}).forEach(id => {
      const machineData = oldData.machines[id];
      if (machineData) {
        const rawErrors = machineData.errors.map((e: MLCError & { timestamp: string }) => ({
          ...e,
          timestamp: new Date(e.timestamp),
          isHardError: undefined,
          isMotorReplacement: undefined,
          groupedCount: undefined,
        }));
        const replacements = machineData.replacements.map((r: MotorReplacement & { replacementDate: string }) => ({
          ...r,
          replacementDate: new Date(r.replacementDate),
        }));
        
        result[id] = {
          rawErrors,
          processedErrors: processErrors(rawErrors, replacements, groupingWindowSeconds),
          replacements,
        };
      }
    });
    
    localStorage.removeItem('mlc-dashboard-data');
    console.log('Migrated from old storage format to v2');
    
    return result;
  } catch (error) {
    console.error('Failed to migrate from old format:', error);
    return null;
  }
};

/**
 * Provides machine-level MLC error and replacement state management.
 *
 * @returns Machine data state and mutation helpers.
 */
export const useMachineData = () => {
  const [groupingWindowSeconds, setGroupingWindowSecondsState] = useState(() => {
    const stored = localStorage.getItem(GROUPING_STORAGE_KEY);
    return stored ? parseInt(stored) || 30 : 30;
  });
  
  const [machineData, setMachineData] = useState<Record<string, ExtendedMachineData>>(createInitialData);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as StoredData;
        setMachineData(deserializeMachineData(parsed, groupingWindowSeconds));
      } else {
        const migrated = migrateFromOldFormat(groupingWindowSeconds);
        if (migrated) {
          setMachineData(migrated);
        }
      }
    } catch (error) {
      console.error('Failed to load data from localStorage:', error);
    }
    setIsLoaded(true);
  }, []);

  // Save to localStorage when data changes
  useEffect(() => {
    if (isLoaded) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeMachineData(machineData)));
      } catch (error) {
        console.error('Failed to save data to localStorage:', error);
      }
    }
  }, [machineData, isLoaded]);

  const setGroupingWindowSeconds = useCallback((seconds: number) => {
    setGroupingWindowSecondsState(seconds);
    localStorage.setItem(GROUPING_STORAGE_KEY, seconds.toString());
    
    setMachineData(prev => {
      const result: Record<string, ExtendedMachineData> = {};
      Object.keys(prev).forEach(id => {
        const current = prev[id];
        result[id] = {
          ...current,
          processedErrors: processErrors(current.rawErrors, current.replacements, seconds),
        };
      });
      return result;
    });
  }, []);

  const addErrors = useCallback((machineId: MachineId, newErrors: MLCError[], groupingSeconds?: number) => {
    setMachineData(prev => {
      const current = prev[machineId] || createEmptyExtendedMachineData();
      
      const strippedNewErrors = newErrors.map(stripProcessingFlags);
      const mergedRawErrors = mergeErrors(current.rawErrors, strippedNewErrors);
      
      const processed = processErrors(
        mergedRawErrors, 
        current.replacements, 
        groupingSeconds ?? groupingWindowSeconds
      );
      
      return {
        ...prev,
        [machineId]: {
          ...current,
          rawErrors: mergedRawErrors,
          processedErrors: processed,
        },
      };
    });
  }, [groupingWindowSeconds]);

  const addReplacement = useCallback((machineId: MachineId, replacement: MotorReplacement) => {
    setMachineData(prev => {
      const current = prev[machineId] || createEmptyExtendedMachineData();
      const newReplacements = [...current.replacements, replacement];
      const processed = processErrors(current.rawErrors, newReplacements, groupingWindowSeconds);
      
      return {
        ...prev,
        [machineId]: {
          rawErrors: current.rawErrors,
          processedErrors: processed,
          replacements: newReplacements,
        },
      };
    });
  }, [groupingWindowSeconds]);

  const addReplacements = useCallback((machineId: MachineId, replacements: MotorReplacement[]) => {
    setMachineData(prev => {
      const current = prev[machineId] || createEmptyExtendedMachineData();
      const existingIds = new Set(current.replacements.map(r => r.id));
      const newReplacements = [
        ...current.replacements,
        ...replacements.filter(r => !existingIds.has(r.id))
      ];
      const processed = processErrors(current.rawErrors, newReplacements, groupingWindowSeconds);
      
      return {
        ...prev,
        [machineId]: {
          rawErrors: current.rawErrors,
          processedErrors: processed,
          replacements: newReplacements,
        },
      };
    });
  }, [groupingWindowSeconds]);

  const removeReplacement = useCallback((machineId: MachineId, replacementId: string) => {
    setMachineData(prev => {
      const current = prev[machineId] || createEmptyExtendedMachineData();
      const newReplacements = current.replacements.filter(r => r.id !== replacementId);
      const processed = processErrors(current.rawErrors, newReplacements, groupingWindowSeconds);
      
      return {
        ...prev,
        [machineId]: {
          rawErrors: current.rawErrors,
          processedErrors: processed,
          replacements: newReplacements,
        },
      };
    });
  }, [groupingWindowSeconds]);

  const clearMachineData = useCallback((machineId: MachineId) => {
    setMachineData(prev => ({
      ...prev,
      [machineId]: createEmptyExtendedMachineData(),
    }));
  }, []);

  // Return processed errors as "errors" for backwards compatibility
  const getMachineDataCompat = useCallback((): Record<string, MachineData> => {
    const result: Record<string, MachineData> = {};
    Object.keys(machineData).forEach(id => {
      result[id] = {
        errors: machineData[id].processedErrors,
        replacements: machineData[id].replacements,
      };
    });
    return result;
  }, [machineData]);

  const getRawErrors = useCallback((machineId: MachineId): MLCError[] => {
    return machineData[machineId]?.rawErrors || [];
  }, [machineData]);

  const compatibleMachineData = getMachineDataCompat();

  return {
    machineData: compatibleMachineData,
    isLoaded,
    addErrors,
    addReplacement,
    addReplacements,
    removeReplacement,
    clearMachineData,
    groupingWindowSeconds,
    setGroupingWindowSeconds,
    getRawErrors,
  };
};
