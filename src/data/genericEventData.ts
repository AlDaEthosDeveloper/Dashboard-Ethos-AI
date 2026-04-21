// Generic Event Data for non-MLC event logs
import { MachineId } from './mlcErrorData';

export interface GenericEvent {
  id: string;
  timestamp: Date;
  machineSerial: MachineId;
  logType: string;
  eventCode: string;
  component: string;
  description: string;
  severity: 'Info' | 'Warning' | 'Error' | 'Critical';
  data1?: number;
  data2?: number;
  rawData?: Record<string, string>;
  count?: number;
  min?: number;
  max?: number;
  avg?: number;
}

/**
 * Normalizes mixed/raw severity values into dashboard severity buckets.
 *
 * @param value Candidate raw severity.
 * @param fallbackText Optional fallback text to infer severity when value is empty.
 * @returns Normalized severity level.
 */
export const normalizeEventSeverity = (
  value: unknown,
  fallbackText = '',
): GenericEvent['severity'] => {
  const normalized = String(value ?? '').trim().toLowerCase();

  if (normalized.includes('critical') || normalized.includes('fatal')) return 'Critical';
  if (normalized.includes('error') || normalized.includes('fault')) return 'Error';
  if (normalized.includes('warn')) return 'Warning';
  if (normalized.includes('info')) return 'Info';

  const fallback = fallbackText.toLowerCase();
  if (fallback.includes('critical') || fallback.includes('fatal')) return 'Critical';
  if (fallback.includes('error') || fallback.includes('fault')) return 'Error';
  if (fallback.includes('warn')) return 'Warning';

  return 'Info';
};

/**
 * Builds a stable deduplication key for a generic event.
 *
 * @param event Event record.
 * @returns Deterministic key composed of timestamp, source, and identity fields.
 */
export const getEventKey = (event: GenericEvent): string => {
  return `${event.timestamp.getTime()}-${event.machineSerial}-${event.logType}-${event.eventCode}-${event.component}`;
};

/**
 * Merges and deduplicates generic events using `getEventKey`.
 *
 * @param existing Existing event list.
 * @param newEvents Newly parsed event list.
 * @returns Deduplicated merged events sorted by descending timestamp.
 */
export const mergeEvents = (existing: GenericEvent[], newEvents: GenericEvent[]): GenericEvent[] => {
  const eventMap = new Map<string, GenericEvent>();
  
  existing.forEach(e => eventMap.set(getEventKey(e), e));
  newEvents.forEach(e => eventMap.set(getEventKey(e), e));
  
  return Array.from(eventMap.values()).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
};
