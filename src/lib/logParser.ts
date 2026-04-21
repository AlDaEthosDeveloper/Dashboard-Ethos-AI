import JSZip from 'jszip';
import { MachineId } from '@/data/mlcErrorData';
import { GenericEvent } from '@/data/genericEventData';
import { EventLogType, detectLogTypeFromFilename, detectLogTypeFromContent } from '@/data/eventLogTypes';

export interface LogEntry {
  id: string;
  date: string;
  time: string;
  facility: string;
  severity: 'Info' | 'Warning' | 'Error' | 'Fault' | 'Debug' | 'Notice' | 'Critical';
  preciseTime: string;
  serialNumber: string;
  component: string;
  type: string;
  message: string;
  errorCode?: string;
  rawLine: string;
  leafBank?: string;
  leafId?: number;
  positionError?: number;
  mode?: string;
}

export interface ParsedLogFile {
  filename: string;
  entries: LogEntry[];
  stats: LogStats;
  parseTime: number;
}

export interface LogStats {
  totalLines: number;
  parsedLines: number;
  bySerial: Record<string, number>;
  bySeverity: Record<string, number>;
  byComponent: Record<string, number>;
  byHour: Record<string, number>;
  faults: LogEntry[];
  errors: LogEntry[];
  warnings: LogEntry[];
}

// Parse a single log line using the Ethos Combined Log format
/**
 * Parses input data in `parseLogLine`.
 *
 * @param args Function input.
 * @returns Parsed result.
 */
function parseLogLine(line: string, index: number): LogEntry | null {
  // Skip empty lines
  if (!line.trim()) return null;

  // Expected format:
  // 2025-05-23	07:40:00	Local0	Info	07:40:00:622	SN# 2106	COL	Fault	CMNFault::ack...
  // Date	Time	Facility	Severity	PreciseTime	Serial	Component	Type	Message
  
  const parts = line.split('\t');
  
  if (parts.length < 8) return null;

  const [date, time, facility, severity, preciseTime, serial, component, type, ...messageParts] = parts;
  
  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  
  const message = messageParts.join('\t');
  
  // Extract error code if present (e.g., "420219")
  const errorCodeMatch = message.match(/\((\d{6}):/);
  const errorCode = errorCodeMatch ? errorCodeMatch[1] : undefined;

  // Extract leaf information for MLC trajectory errors
  let leafBank: string | undefined;
  let leafId: number | undefined;
  let positionError: number | undefined;
  let mode: string | undefined;

  // Pattern: "Leaf A" or "Leaf B"
  const leafMatch = message.match(/Leaf\s+([AB])\./);
  if (leafMatch) {
    leafBank = leafMatch[1];
  }

  // Pattern: "Leaf Id = 8.000000000"
  const leafIdMatch = message.match(/Leaf Id\s*=\s*([\d.]+)/);
  if (leafIdMatch) {
    leafId = parseInt(leafIdMatch[1]);
  }

  // Pattern: "Readout = -0.0031783809"
  const readoutMatch = message.match(/Readout\s*=\s*([-\d.]+)/);
  if (readoutMatch) {
    positionError = parseFloat(readoutMatch[1]);
  }

  // Pattern: "in clinical mode" or "in service mode"
  const modeMatch = message.match(/in\s+(\w+)\s+mode/i);
  if (modeMatch) {
    mode = modeMatch[1];
  }

  // Clean up serial number (remove "SN# " prefix)
  const cleanSerial = serial.match(/\bSN\s*#?\s*(\d+)\b/i)?.[1] ?? null;


  return {
    id: `log-${index}-${Date.now()}`,
    date,
    time,
    facility,
    severity: severity as LogEntry['severity'],
    preciseTime,
    serialNumber: cleanSerial,
    component: component.trim(),
    type: type.trim(),
    message: message.trim(),
    errorCode,
    rawLine: line,
    leafBank,
    leafId,
    positionError,
    mode,
  };
}

// Calculate statistics from parsed entries
/**
 * Executes `calculateStats`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
function calculateStats(entries: LogEntry[], totalLines: number): LogStats {
  const bySerial: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const byComponent: Record<string, number> = {};
  const byHour: Record<string, number> = {};
  const faults: LogEntry[] = [];
  const errors: LogEntry[] = [];
  const warnings: LogEntry[] = [];

  for (const entry of entries) {
    // By serial
    bySerial[entry.serialNumber] = (bySerial[entry.serialNumber] || 0) + 1;

    // By severity
    bySeverity[entry.severity] = (bySeverity[entry.severity] || 0) + 1;

    // By component
    byComponent[entry.component] = (byComponent[entry.component] || 0) + 1;

    // By hour
    const hour = entry.time.split(':')[0];
    byHour[hour] = (byHour[hour] || 0) + 1;

    // Collect important entries
    if (entry.type === 'Fault' || entry.severity === 'Fault') {
      faults.push(entry);
    }
    if (entry.severity === 'Error' || entry.type === 'Error') {
      errors.push(entry);
    }
    if (entry.severity === 'Warning') {
      warnings.push(entry);
    }
  }

  return {
    totalLines,
    parsedLines: entries.length,
    bySerial,
    bySeverity,
    byComponent,
    byHour,
    faults,
    errors,
    warnings,
  };
}

// Parse log content from text
/**
 * Parses input data in `parseLogContent`.
 *
 * @param args Function input.
 * @returns Parsed result.
 */
export function parseLogContent(content: string, filename: string): ParsedLogFile {
  const startTime = performance.now();
  
  const lines = content.split('\n');
  const entries: LogEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const entry = parseLogLine(lines[i], i);
    if (entry) {
      entries.push(entry);
    }
  }

  const stats = calculateStats(entries, lines.length);
  const parseTime = performance.now() - startTime;

  return {
    filename,
    entries,
    stats,
    parseTime,
  };
}

// Extract and parse logs from a ZIP file
export async function parseZipFile(file: File): Promise<ParsedLogFile[]> {
  const zip = new JSZip();
  const contents = await zip.loadAsync(file);
  const results: ParsedLogFile[] = [];

  for (const [filename, zipEntry] of Object.entries(contents.files)) {
    if (zipEntry.dir) continue;
    
    // Only process text files
    if (filename.endsWith('.txt') || filename.endsWith('.log') || !filename.includes('.')) {
      const content = await zipEntry.async('string');
      const parsed = parseLogContent(content, filename);
      results.push(parsed);
    }
  }

  return results;
}

// Parse a file (auto-detect ZIP vs text)
export async function parseFile(file: File): Promise<ParsedLogFile[]> {
  if (file.name.endsWith('.zip')) {
    return parseZipFile(file);
  } else {
    const content = await file.text();
    return [parseLogContent(content, file.name)];
  }
}

// Merge multiple parsed files into one
/**
 * Executes `mergeLogFiles`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export function mergeLogFiles(files: ParsedLogFile[]): ParsedLogFile {
  const allEntries: LogEntry[] = [];
  let totalParseTime = 0;
  const filenames: string[] = [];

  for (const file of files) {
    allEntries.push(...file.entries);
    totalParseTime += file.parseTime;
    filenames.push(file.filename);
  }

  // Sort by date and time
  allEntries.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return a.preciseTime.localeCompare(b.preciseTime);
  });

  const totalLines = files.reduce((sum, f) => sum + f.stats.totalLines, 0);
  const stats = calculateStats(allEntries, totalLines);

  return {
    filename: filenames.length === 1 ? filenames[0] : `${filenames.length} files merged`,
    entries: allEntries,
    stats,
    parseTime: totalParseTime,
  };
}
