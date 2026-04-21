import { MachineId } from '@/data/mlcErrorData';
import { GenericEvent } from '@/data/genericEventData';
import { EventLogType, detectLogTypeFromFilename, detectLogTypeFromContent } from '@/data/eventLogTypes';

/**
 * Parses non-COL EventLog XML files into normalized generic events.
 *
 * @param xmlContent Raw XML file content.
 * @param filename Original file name used for log-type detection fallback.
 * @param fallbackMachineId Machine ID used when XML metadata does not expose one.
 * @returns Parsed generic event records.
 */
export const parseGenericEventLog = (
  xmlContent: string,
  filename: string,
  fallbackMachineId: MachineId
): GenericEvent[] => {
  const events: GenericEvent[] = [];
  
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');
    
    // Detect log type
    let logType = detectLogTypeFromFilename(filename);
    const contentLogType = detectLogTypeFromContent(xmlContent);
    if (contentLogType) logType = contentLogType;
    
    // Skip COL logs - those are handled by the MLC parser
    if (logType === 'COL') return [];
    
    // Get machine ID from XML content first, fall back to provided ID
    const machineIdElement = xmlDoc.querySelector('machineId');
    const xmlMachineIdRaw = machineIdElement?.textContent?.trim();
    
    let resolvedMachineId: MachineId = fallbackMachineId;
    if (xmlMachineIdRaw) {
      const numericId = xmlMachineIdRaw.replace(/\D/g, '');
      resolvedMachineId = `HAL${numericId}`;
    }
    
    // Find all Event or Fault elements
    const eventElements = xmlDoc.querySelectorAll('Event, Fault, Record, Entry');
    
    eventElements.forEach((eventEl: Element, index: number): void => {
      const id = eventEl.getAttribute('id') || String(index);
      const keyElement = eventEl.querySelector('key, type, name');
      const descrElement = eventEl.querySelector('descr, description, message, msg');
      const timeElement = eventEl.querySelector('time, timestamp, dateTime');
      const data1Element = eventEl.querySelector('data1, value1, param1');
      const data2Element = eventEl.querySelector('data2, value2, param2');
      const severityElement = eventEl.querySelector('severity, level, priority');
      
      const component = keyElement?.textContent || eventEl.getAttribute('type') || 'Unknown';
      const description = descrElement?.textContent || '';
      const timeStr = timeElement?.textContent || '';
      const data1 = parseFloat(data1Element?.textContent || '0');
      const data2 = parseFloat(data2Element?.textContent || '0');
      
      // Parse timestamp
      const timestamp = parseGenericTimestamp(timeStr);
      if (!timestamp) return;
      
      // Parse severity
      let severity: GenericEvent['severity'] = 'Info';
      /**
       * Executes `severityText`.
       *
       * @param args Function input.
       * @returns Execution result.
       */
      const severityText = (severityElement?.textContent || '').toLowerCase();
      if (severityText.includes('critical') || severityText.includes('fatal')) severity = 'Critical';
      else if (severityText.includes('error') || severityText.includes('fault')) severity = 'Error';
      else if (severityText.includes('warn')) severity = 'Warning';
      
      // Collect raw data attributes
      const rawData: Record<string, string> = {};
      for (const attr of Array.from(eventEl.attributes)) {
        rawData[attr.name] = attr.value;
      }
      eventEl.querySelectorAll('*').forEach((child: Element): void => {
        if (child.textContent && child.children.length === 0) {
          rawData[child.tagName] = child.textContent;
        }
      });
      
      events.push({
        id: `${resolvedMachineId}-${logType}-${id}-${timestamp.getTime()}`,
        timestamp,
        machineSerial: resolvedMachineId,
        logType,
        eventCode: id,
        component,
        description,
        severity,
        data1: isNaN(data1) ? undefined : data1,
        data2: isNaN(data2) ? undefined : data2,
        rawData,
      });
    });
  } catch (error) {
    console.error('Error parsing generic event log:', error);
  }
  
  return events;
};

/**
 * Parses a timestamp value used by heterogeneous EventLog XML sources.
 *
 * @param timeStr Timestamp string in XML payload.
 * @returns Date instance when parsing succeeds; otherwise `null`.
 */
const parseGenericTimestamp = (timeStr: string): Date | null => {
  if (!timeStr) return null;
  
  try {
    // Format: "2026/01/12 11:30:20:480"
    const match1 = timeStr.match(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2}):?(\d+)?/);
    if (match1) {
      const [, year, month, day, hour, minute, second, ms] = match1;
      return new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second),
        parseInt(ms || '0')
      );
    }
    
    // ISO format
    const isoDate = new Date(timeStr);
    if (!isNaN(isoDate.getTime())) return isoDate;
    
    // Format: "2026-01-12T11:30:20"
    const match2 = timeStr.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (match2) {
      const [, year, month, day, hour, minute, second] = match2;
      return new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second)
      );
    }
    
    return null;
  } catch {
    return null;
  }
};
