import { MLCError, MachineId, getBankFromErrorCode } from '@/data/mlcErrorData';
import { GenericEvent } from '@/data/genericEventData';
import { EventLogType } from '@/data/eventLogTypes';

export interface CombinedLogResult {
  mlcErrors: MLCError[];
  genericEvents: GenericEvent[];
}

/** TAB-column filter definition */
export interface TabColumnFilter {
  /** zero-based TAB column index */
  columnIndex: number;

  /** at least one of these must be present */
  includeAny?: string[];

  /** all of these must be present */
  includeAll?: string[];

  /** none of these may be present */
  exclude?: string[];
}


/**
 * Applies include/exclude filters against pre-split TAB columns.
 *
 * @param parts TAB-separated fields from one combined log line.
 * @param filters Optional filter set.
 * @returns `true` when the line satisfies every configured filter.
 */
function passesTabFilters(parts: string[], filters?: TabColumnFilter[]): boolean {
  if (!filters || filters.length === 0) return true;

  for (const filter of filters) {
    const value = parts[filter.columnIndex];
    if (!value) return false;

    if (filter.includeAny && !filter.includeAny.some(k => value.includes(k))) {
      return false;
    }

    if (filter.includeAll && !filter.includeAll.every(k => value.includes(k))) {
      return false;
    }

    if (filter.exclude && filter.exclude.some(k => value.includes(k))) {
      return false;
    }
  }

  return true;
}

/**
 * Parses Varian Ethos combined `.txt` logs into MLC errors and generic events.
 *
 * @param content Raw file content.
 * @param filename Source file name (kept for call-site parity).
 * @param fallbackMachineId Machine ID used when a serial number cannot be extracted.
 * @param tabFilters Optional early-rejection filters on TAB columns.
 * @returns Parsed MLC and generic event records.
 */
export const parseCombinedLogContent = (
  content: string,
  filename: string,
  fallbackMachineId: MachineId,
  tabFilters?: TabColumnFilter[]
): CombinedLogResult => {

  const mlcErrors: MLCError[] = [];
  const genericEvents: GenericEvent[] = [];

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw) continue;

    const parts = raw.split('\t');

    // ultra-early rejection
    if (!passesTabFilters(parts, tabFilters)) continue;

    const parsed = parseTxtLogLineFromParts(parts, i, fallbackMachineId);
    if (!parsed) continue;

    if (parsed.type === 'mlc') {
      mlcErrors.push(parsed.data as MLCError);
    } else {
      genericEvents.push(parsed.data as GenericEvent);
    }
  }

  return { mlcErrors, genericEvents };
};

/**
 * Parses a single log line already split by TAB delimiters.
 *
 * @param parts TAB-split fields for one row.
 * @param index Zero-based line index for deterministic ID generation.
 * @param fallbackMachineId Machine ID used when serial metadata is unavailable.
 * @returns Parsed record descriptor, or `null` when row is invalid/unsupported.
 */
function parseTxtLogLineFromParts(
  parts: string[],
  index: number,
  fallbackMachineId: MachineId
): { type: 'mlc' | 'generic'; data: MLCError | GenericEvent } | null {

  if (parts.length < 8) return null;

  const [
    date,
    _time,
    facility,
    severity,
    preciseTime,
    serial,
    component,
    type,
    ...messageParts
  ] = parts;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const message = messageParts.join('\t');

  // ---- Machine ID ----
  const serialMatch = serial.match(/\bSN\s*#?\s*(\d+)\b/i);
  const numericId = serialMatch?.[1];
  let machineId: MachineId = fallbackMachineId;

  if (numericId) {
    machineId = `HAL${numericId}`;
  }

  // ---- Timestamp ----
  const timestamp = parseTxtTimestamp(date, preciseTime);
  if (!timestamp) return null;

  // ---- MLC fault detection ----
  if (component === 'COL' && type === 'Fault' && isMlcFaultMessage(message)) {
    const mlcError = parseMlcFaultFromMessage(message, timestamp, machineId);
    if (mlcError) {
      return { type: 'mlc', data: mlcError };
    }
  }

  // ---- Generic event ----
  const logType = mapComponentToLogType(component);
  const eventSeverity = mapSeverity(severity);

  const errorCodeMatch = message.match(/\((\d{6}):/);
  const eventCode = errorCodeMatch ? errorCodeMatch[1] : type;

  const genericEvent: GenericEvent = {
    id: `${machineId}-${logType}-${index}-${timestamp.getTime()}`,
    timestamp,
    machineSerial: machineId,
    logType,
    eventCode,
    component: `${component}.${type}`,
    description: message.substring(0, 500),
    severity: eventSeverity,
    rawData: {
      facility,
      preciseTime,
      fullMessage: message,
    },
  };

  return { type: 'generic', data: genericEvent };
}

/**
 * Detects whether a combined-log message describes an MLC fault.
 *
 * @param message Combined-log message content.
 * @returns `true` when the message pattern matches known MLC fault signatures.
 */
function isMlcFaultMessage(message: string): boolean {
  return (
    message.includes('MLC Trajectory Deviation') ||
    message.includes('Leaf A.') ||
    message.includes('Leaf B.') ||
    (message.includes('Leaf Id') && message.includes('Readout'))
  );
}

/**
 * Parses one MLC fault message into an `MLCError` domain object.
 *
 * @param message Fault message text.
 * @param timestamp Parsed event timestamp.
 * @param machineId Machine identifier.
 * @returns Parsed `MLCError` or `null` if mandatory fields are missing.
 */
function parseMlcFaultFromMessage(
  message: string,
  timestamp: Date,
  machineId: MachineId
): MLCError | null {

  const errorCodeMatch = message.match(/\((\d{6}):/);
  const errorCode = errorCodeMatch?.[1] || 'Unknown';

  const bankMatch = message.match(/Leaf\s+([AB])\./);
  const bank: 'A' | 'B' = bankMatch?.[1] as 'A' | 'B' || getBankFromErrorCode(errorCode);

  const leafIdMatch = message.match(/Leaf Id\s*=\s*([\d.]+)/);
  const mlcMotor = leafIdMatch ? Math.round(parseFloat(leafIdMatch[1])) : 0;

  if (mlcMotor <= 0 || mlcMotor > 57) return null;

  const readoutMatch = message.match(/Readout\s*=\s*([-\d.]+)/);
  const errorPosition = readoutMatch ? parseFloat(readoutMatch[1]) : 0;

  const modeMatch = message.match(/in\s+(\w+)\s+mode/i);
  const mode = modeMatch?.[1] || '';

  const errorText = `MLC Trajectory Deviation Leaf ${bank}. Motor ${mlcMotor}, Position Error: ${errorPosition.toFixed(2)}mm${mode ? ` (${mode} mode)` : ''}`;

  return {
    timestamp,
    machineSerial: machineId,
    errorCode,
    location: 'CombinedLog',
    region: '',
    country: '',
    component: 'MLC.TrajDrift',
    errorText,
    severity: 'Error',
    mlcMotor,
    errorPosition,
    bank,
  };
}

/**
 * Parses timestamp parts from combined log date and precise time fields.
 *
 * @param date Date field in `yyyy-MM-dd` format.
 * @param preciseTime Time field in `HH:mm:ss[:SSS]` format.
 * @returns Date when parsing succeeds; otherwise `null`.
 */
function parseTxtTimestamp(date: string, preciseTime: string): Date | null {
  if (!date || !preciseTime) return null;

  try {
    const dateMatch = date.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!dateMatch) return null;

    const timeMatch = preciseTime.match(/(\d{2}):(\d{2}):(\d{2})[:.]?(\d+)?/);
    if (!timeMatch) return null;

    const [, year, month, day] = dateMatch;
    const [, hour, minute, second, ms] = timeMatch;

    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second),
      parseInt(ms || '0')
    );
  } catch {
    return null;
  }
}

/**
 * Maps a combined-log component code to the dashboard event-log type.
 *
 * @param component Component token from the log row.
 * @returns Normalized event-log type.
 */
function mapComponentToLogType(component: string): EventLogType {
  switch (component.toUpperCase()) {
    case 'COL': return 'COL';
    case 'MLC': return 'MLC';
    case 'MOT':
    case 'GAN':
    case 'GAT': return 'Motion';
    case 'BEA':
    case 'DOS': return 'Beam';
    case 'IMG':
    case 'IVI':
    case 'XRY': return 'Image';
    default: return 'Other';
  }
}

/**
 * Maps raw severity text to normalized event severity.
 *
 * @param severity Raw severity token.
 * @returns Normalized severity bucket.
 */
function mapSeverity(severity: string): GenericEvent['severity'] {
  const lower = severity.toLowerCase();
  if (lower === 'critical' || lower === 'fatal') return 'Critical';
  if (lower === 'error' || lower === 'fault') return 'Error';
  if (lower === 'warning' || lower === 'warn') return 'Warning';
  return 'Info';
}

/**
 * Checks if a file name looks like a combined-log export.
 *
 * @param filename Candidate file name.
 * @returns `true` when naming heuristics indicate a combined-log text file.
 */
export const isCombinedLogFile = (filename: string): boolean => {
  const lower = filename.toLowerCase();
  return lower.endsWith('.txt') && (
    lower.includes('combined') ||
    lower.includes('ethos') ||
    lower.includes('log')
  );
};

/**
 * Checks if a file has a `.txt` extension.
 *
 * @param filename Candidate file name.
 * @returns `true` when the file extension is `.txt`.
 */
export const isTxtLogFile = (filename: string): boolean => {
  return filename.toLowerCase().endsWith('.txt');
};
