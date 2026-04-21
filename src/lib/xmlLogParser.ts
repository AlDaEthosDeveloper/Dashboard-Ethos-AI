import { MLCError, MachineId, getBankFromErrorCode, getMachineIds } from '@/data/mlcErrorData';

/**
 * Represents a parsed `<Fault>` node from a COL event log.
 */
interface ParsedFault {
  id: string;
  key: string;
  description: string;
  time: string;
  data1: number; // Motor number
  data2: number; // Error position
}

/**
 * Parses a COL EventLog XML payload into normalized MLC errors.
 *
 * @param xmlContent Raw XML file content.
 * @param fallbackMachineId Machine ID to use when XML does not contain a machine identifier.
 * @returns Parsed and normalized MLC errors.
 */
export const parseXMLLogContent = (xmlContent: string, fallbackMachineId: MachineId): MLCError[] => {
  const errors: MLCError[] = [];
  
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');
    
    // Get machine ID from XML content first, fall back to provided ID
    const machineIdElement = xmlDoc.querySelector('machineId');
    const xmlMachineIdRaw = machineIdElement?.textContent?.trim();
    
    // Convert XML machineId (e.g., "2106") to our format (e.g., "HAL2106")
    let resolvedMachineId: MachineId = fallbackMachineId;
    if (xmlMachineIdRaw) {
      // Handle both formats: "2106" or "HAL2106"
      const numericId = xmlMachineIdRaw.replace(/\D/g, '');
      const potentialId = `HAL${numericId}`;
      const configuredIds = getMachineIds();
      if (configuredIds.includes(potentialId)) {
        resolvedMachineId = potentialId;
      } else {
        // Accept any machine ID found in the data
        resolvedMachineId = potentialId;
      }
    }
    
    // Find all Fault elements
    const faults = xmlDoc.querySelectorAll('Fault');
    
    faults.forEach((fault: Element): void => {
      const id = fault.getAttribute('id') || '';
      const keyElement = fault.querySelector('key');
      const descrElement = fault.querySelector('descr');
      const timeElement = fault.querySelector('time');
      const data1Element = fault.querySelector('data1');
      const data2Element = fault.querySelector('data2');
      
      // Only process MLC-related faults (TrajDrift, etc.)
      const key: string = keyElement?.textContent || '';
      if (!key.includes('MLC') && !key.includes('Leaf')) {
        return;
      }
      
      const description = descrElement?.textContent || '';
      const timeStr = timeElement?.textContent || '';
      const mlcMotor = Math.round(parseFloat(data1Element?.textContent || '0'));
      const errorPosition = parseFloat(data2Element?.textContent || '0');
      
      if (mlcMotor <= 0 || mlcMotor > 57) {
        return;
      }
      
      // Parse timestamp: "2026/01/12 11:30:20:480"
      const timestamp = parseXMLTimestamp(timeStr);
      if (!timestamp) {
        return;
      }
      
      // Determine bank from error code
      const bank = getBankFromErrorCode(id);
      
      // Determine error text and component from key
      const errorText = description.replace('{0}', String(mlcMotor)).replace('{1}', String(errorPosition));
      
      errors.push({
        timestamp,
        machineSerial: resolvedMachineId,
        errorCode: id,
        location: 'EventLog',
        region: '',
        country: '',
        component: key,
        errorText,
        severity: 'Error',
        mlcMotor,
        errorPosition,
        bank,
      });
    });
  } catch (error) {
    console.error('Error parsing XML log:', error);
  }
  
  return errors;
};

/**
 * Parses an XML timestamp with millisecond suffix.
 *
 * @param timeStr Timestamp string in `yyyy/MM/dd HH:mm:ss:SSS` format.
 * @returns Date instance when parsing succeeds; otherwise `null`.
 */
const parseXMLTimestamp = (timeStr: string): Date | null => {
  if (!timeStr) return null;
  
  try {
    // Format: "2026/01/12 11:30:20:480"
    const match = timeStr.match(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2}):?(\d+)?/);
    if (!match) return null;
    
    const [, year, month, day, hour, minute, second, ms] = match;
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
};

/**
 * Extracts a HAL machine identifier from a file name.
 *
 * @param filename Source file name.
 * @returns Matched machine ID or `null` when not present.
 */
export const extractMachineIdFromFilename = (filename: string): MachineId | null => {
  const match = filename.match(/HAL(\d{4})/i);
  if (match) {
    return `HAL${match[1]}`;
  }
  return null;
};

/**
 * Checks whether a path points to a COL EventLog XML file.
 *
 * @param path Candidate file path.
 * @returns `true` when the path matches the expected EventLog naming pattern.
 */
export const isEventLogFile = (path: string): boolean => {
  const normalizedPath = path.replace(/\\/g, '/');
  return (
    normalizedPath.includes('EventLog/') && 
    normalizedPath.endsWith('_COLEventLog.xml')
  );
};

/**
 * Filters a set of file paths to COL EventLog XML entries.
 *
 * @param files Candidate file paths.
 * @returns Paths recognized as COL EventLog files.
 */
export const findEventLogFiles = (files: string[]): string[] => {
  return files.filter(isEventLogFile);
};
