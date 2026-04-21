// MLC Error Data from Varian Ethos Machines
export interface MLCError {
  timestamp: Date;
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
  isHardError?: boolean;
  isMotorReplacement?: boolean;
  groupedCount?: number;
}

export interface MotorReplacement {
  id: string;
  machineSerial: string;
  mlcMotor: number;
  bank: 'A' | 'B';
  replacementDate: Date;
  replacedBy: string;
  notes?: string;
}

export interface MachineData {
  errors: MLCError[];
  replacements: MotorReplacement[];
}

// MachineId is now a dynamic string — no longer a hardcoded union type
export type MachineId = string;

// Default machine IDs (used only as initial fallback when no config exists)
export const DEFAULT_MACHINE_IDS: string[] = ['HAL2106', 'HAL2403', 'HAL2533'];

// MACHINE_IDS is now dynamically loaded from config
// This getter reads from localStorage so it's always in sync
const CONFIG_STORAGE_KEY = 'ethos-dashboard-config';

/**
 * Returns machine identifiers from persisted app config.
 *
 * @returns Configured machine IDs, or default IDs when config is unavailable.
 */
export const getMachineIds = (): string[] => {
  try {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (stored) {
      const config = JSON.parse(stored);
      if (config.machineIds && Array.isArray(config.machineIds) && config.machineIds.length > 0) {
        return config.machineIds;
      }
    }
  } catch {}
  return DEFAULT_MACHINE_IDS;
};

// For backwards compatibility - this is a getter that returns current machine IDs
// Components should prefer useAppConfig().machineIds where possible
export const MACHINE_IDS: string[] = new Proxy(DEFAULT_MACHINE_IDS, {
  /**
   * Proxies array-like access to the latest machine-id snapshot.
   *
   * @param target Proxy target (unused, kept for trap signature compatibility).
   * @param prop Requested property key.
   * @returns Property value resolved against current configured machine IDs.
   */
  get(target: string[], prop: string | symbol): unknown {
    const ids = getMachineIds();
    if (prop === 'length') return ids.length;
    if (prop === Symbol.iterator) return ids[Symbol.iterator].bind(ids);
    if (prop === 'forEach') return ids.forEach.bind(ids);
    if (prop === 'map') return ids.map.bind(ids);
    if (prop === 'filter') return ids.filter.bind(ids);
    if (prop === 'reduce') return ids.reduce.bind(ids);
    if (prop === 'includes') return ids.includes.bind(ids);
    if (prop === 'indexOf') return ids.indexOf.bind(ids);
    if (prop === 'some') return ids.some.bind(ids);
    if (prop === 'every') return ids.every.bind(ids);
    if (prop === 'find') return ids.find.bind(ids);
    if (prop === 'findIndex') return ids.findIndex.bind(ids);
    if (prop === 'slice') return ids.slice.bind(ids);
    if (prop === 'join') return ids.join.bind(ids);
    if (typeof prop === 'string' && !isNaN(Number(prop))) {
      return ids[Number(prop)];
    }
    return (ids as any)[prop];
  },
});

/**
 * Determines MLC bank parity from an error code.
 *
 * @param errorCode Numeric error code as string.
 * @returns Bank `A` for odd/invalid codes and bank `B` for even codes.
 */
export const getBankFromErrorCode = (errorCode: string): 'A' | 'B' => {
  const code = parseInt(errorCode);
  if (isNaN(code)) return 'A';
  return code % 2 === 0 ? 'B' : 'A';
};

/**
 * Groups consecutive errors by motor/bank within a configured time window.
 *
 * @param errors Raw MLC errors.
 * @param replacements Recorded motor replacement actions.
 * @param groupingWindowSeconds Maximum gap in seconds for grouping adjacent errors.
 * @returns Processed error list with grouping flags.
 */
export const processErrors = (
  errors: MLCError[], 
  replacements: MotorReplacement[],
  groupingWindowSeconds: number = 30
): MLCError[] => {
  if (errors.length === 0) return [];

  const groupingWindowMs = groupingWindowSeconds * 1000;

  // Sort by timestamp, motor, bank
  const sorted = [...errors].sort((a, b) => {
    if (a.mlcMotor !== b.mlcMotor) return a.mlcMotor - b.mlcMotor;
    if (a.bank !== b.bank) return a.bank.localeCompare(b.bank);
    return a.timestamp.getTime() - b.timestamp.getTime();
  });

  const result: MLCError[] = [];
  let i = 0;

  while (i < sorted.length) {
    const current = sorted[i];
    const group: MLCError[] = [current];
    
    // Find all errors within grouping window on same motor/bank
    let j = i + 1;
    while (j < sorted.length) {
      const next = sorted[j];
      if (next.mlcMotor !== current.mlcMotor || next.bank !== current.bank) break;
      
      const timeDiff = Math.abs(next.timestamp.getTime() - group[group.length - 1].timestamp.getTime());
      if (timeDiff <= groupingWindowMs) {
        group.push(next);
        j++;
      } else {
        break;
      }
    }

    // Check if motor was replaced on the same day
    const errorDate = current.timestamp.toDateString();
    const wasReplacedOnDay = replacements.some(r => 
      r.machineSerial === current.machineSerial &&
      r.mlcMotor === current.mlcMotor &&
      r.bank === current.bank &&
      r.replacementDate.toDateString() === errorDate
    );

    if (group.length > 1) {
      // Multiple errors grouped
      const processedError: MLCError = {
        ...current,
        isHardError: !wasReplacedOnDay,
        isMotorReplacement: wasReplacedOnDay,
        groupedCount: group.length,
      };
      result.push(processedError);
    } else {
      result.push({ ...current, isHardError: false, isMotorReplacement: false });
    }

    i = j;
  }

  // Sort back by timestamp descending
  return result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
};

/**
 * Builds a stable deduplication key for one MLC error.
 *
 * @param error Error record.
 * @returns Deterministic unique key.
 */
export const getErrorKey = (error: MLCError): string => {
  return `${error.timestamp.getTime()}-${error.machineSerial}-${error.errorCode}-${error.mlcMotor}-${error.bank}`;
};

/**
 * Merges two error arrays using `getErrorKey`-based deduplication.
 *
 * @param existing Existing stored errors.
 * @param newErrors Newly parsed errors.
 * @returns Deduplicated merged errors.
 */
export const mergeErrors = (existing: MLCError[], newErrors: MLCError[]): MLCError[] => {
  const errorMap = new Map<string, MLCError>();
  
  existing.forEach(e => errorMap.set(getErrorKey(e), e));
  newErrors.forEach(e => errorMap.set(getErrorKey(e), e));
  
  return Array.from(errorMap.values());
};

/**
 * Creates an empty machine dataset container.
 *
 * @returns Empty machine data object.
 */
export const createEmptyMachineData = (): MachineData => ({
  errors: [],
  replacements: [],
});

// Sample data (will be replaced by localStorage data)
export const mlcErrorData: MLCError[] = [];
