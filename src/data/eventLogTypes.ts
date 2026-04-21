// Event Log Types from Varian Ethos Machines
export type EventLogType = 'COL' | 'MLC' | 'Motion' | 'Beam' | 'Image' | 'Other';

export const EVENT_LOG_TYPES: EventLogType[] = ['COL', 'MLC', 'Motion', 'Beam', 'Image', 'Other'];

export const EVENT_LOG_TYPE_LABELS: Record<EventLogType, string> = {
  COL: 'Collimator (COL)',
  MLC: 'MLC Leaves',
  Motion: 'Motion/Gantry',
  Beam: 'Beam Delivery',
  Image: 'Imaging',
  Other: 'Other Events',
};

export const EVENT_LOG_TYPE_COLORS: Record<EventLogType, string> = {
  COL: 'bg-blue-500',
  MLC: 'bg-amber-500',
  Motion: 'bg-purple-500',
  Beam: 'bg-red-500',
  Image: 'bg-green-500',
  Other: 'bg-gray-500',
};

/**
 * Detects event-log type from file naming conventions.
 *
 * @param filename Event log file name.
 * @returns Detected event-log type.
 */
export const detectLogTypeFromFilename = (filename: string): EventLogType => {
  const lowerFilename = filename.toLowerCase();
  
  if (lowerFilename.includes('_coleventlog')) return 'COL';
  if (lowerFilename.includes('_mlceventlog')) return 'MLC';
  if (lowerFilename.includes('_motioneventlog') || lowerFilename.includes('_gantryeventlog')) return 'Motion';
  if (lowerFilename.includes('_beameventlog') || lowerFilename.includes('_deliveryeventlog')) return 'Beam';
  if (lowerFilename.includes('_imageeventlog') || lowerFilename.includes('_imgeventlog')) return 'Image';
  if (lowerFilename.includes('eventlog')) return 'Other';
  
  return 'Other';
};

/**
 * Checks whether a path points to an EventLog XML file.
 *
 * @param path Candidate file path.
 * @returns `true` when the path appears to be an EventLog XML.
 */
export const isAnyEventLogFile = (path: string): boolean => {
  const lowerPath = path.toLowerCase();
  return lowerPath.includes('eventlog') && lowerPath.endsWith('.xml');
};

/**
 * Attempts to infer event-log type from XML content markers.
 *
 * @param xmlContent Raw XML content.
 * @returns Detected log type or `null` when inconclusive.
 */
export const detectLogTypeFromContent = (xmlContent: string): EventLogType | null => {
  // Try to find log type indicators in the XML
  const lowerContent = xmlContent.toLowerCase().substring(0, 2000); // Check first 2000 chars
  
  if (lowerContent.includes('coleventlog') || lowerContent.includes('collimator')) return 'COL';
  if (lowerContent.includes('mlceventlog') || lowerContent.includes('multileaf')) return 'MLC';
  if (lowerContent.includes('motioneventlog') || lowerContent.includes('gantry')) return 'Motion';
  if (lowerContent.includes('beameventlog') || lowerContent.includes('beam')) return 'Beam';
  if (lowerContent.includes('imageeventlog') || lowerContent.includes('imaging')) return 'Image';
  
  return null;
};
