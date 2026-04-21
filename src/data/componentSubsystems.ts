// Component subsystem categorization for event logs
import { GenericEvent } from './genericEventData';

export type DefaultSubsystemType = 'Supervisor' | 'Beam' | 'Collimator' | 'Couch' | 'Stand' | 'XI';
export type EventOperationalMode = 'data' | 'service' | 'clinical';
export type SubsystemType = DefaultSubsystemType | 'Other' | string;

export interface OtherLogTypeAssignment {
  logType: string;
  subsystem: string;
  mode: EventOperationalMode;
}

export interface SubsystemConfig {
  customSubsystems: string[];
  otherLogTypeAssignments: OtherLogTypeAssignment[];
}

export const DEFAULT_SUBSYSTEMS: DefaultSubsystemType[] = ['Supervisor', 'Beam', 'Collimator', 'Couch', 'Stand', 'XI'];
export const SUBSYSTEM_TYPES: SubsystemType[] = [...DEFAULT_SUBSYSTEMS, 'Other'];

export const SUBSYSTEM_PREFIXES: Record<string, DefaultSubsystemType> = {
  SPV: 'Supervisor',
  BGM: 'Beam',
  COL: 'Collimator',
  MLC: 'Collimator',
  CCHU: 'Couch',
  STN: 'Stand',
  XI: 'XI',
};

const DEFAULT_SUBSYSTEM_LABELS: Record<string, string> = {
  Supervisor: 'Supervisor (SPV)',
  Beam: 'Beam (BGM)',
  Collimator: 'Collimator (COL)',
  Couch: 'Couch (CCHU)',
  Stand: 'Stand (STN)',
  XI: 'XI Imaging',
  Other: 'Other Components',
};

const DEFAULT_SUBSYSTEM_COLORS: Record<string, string> = {
  Supervisor: 'bg-blue-500',
  Beam: 'bg-red-500',
  Collimator: 'bg-cyan-500',
  Couch: 'bg-purple-500',
  Stand: 'bg-amber-500',
  XI: 'bg-green-500',
  Other: 'bg-gray-500',
};

const CUSTOM_COLOR_CYCLE = ['bg-indigo-500', 'bg-pink-500', 'bg-emerald-500', 'bg-orange-500', 'bg-sky-500'];

export const getSubsystemFromComponent = (component: string): DefaultSubsystemType | 'Other' => {
  const normalized = component.trim();
  if (DEFAULT_SUBSYSTEMS.includes(normalized as DefaultSubsystemType)) {
    return normalized as DefaultSubsystemType;
  }

  const upperComponent = normalized.toUpperCase();
  for (const [prefix, subsystem] of Object.entries(SUBSYSTEM_PREFIXES)) {
    if (upperComponent.startsWith(prefix)) {
      return subsystem;
    }
  }

  return 'Other';
};

const normalizeName = (value: string) => value.trim();

export const getConfiguredSubsystems = (config?: SubsystemConfig): string[] => {
  const custom = (config?.customSubsystems ?? []).map(normalizeName).filter(Boolean);
  return [...DEFAULT_SUBSYSTEMS, ...custom, 'Other'];
};

export const resolveEventOperationalMode = (event: GenericEvent, config?: SubsystemConfig): EventOperationalMode => {
  const mapped = config?.otherLogTypeAssignments?.find(
    (assignment) => assignment.logType === event.logType,
  );

  if (mapped && getSubsystemFromComponent(event.component) === 'Other') {
    return mapped.mode;
  }

  const content = `${event.description || ''} ${event.rawData?.fullMessage || ''}`.toLowerCase();
  if (content.includes('in service mode')) return 'service';
  if (content.includes('in clinical mode')) return 'clinical';
  return 'data';
};

export const resolveSubsystemForEvent = (event: GenericEvent, config?: SubsystemConfig): string => {
  const fromComponent = getSubsystemFromComponent(event.component);
  if (fromComponent !== 'Other') return fromComponent;

  const mapped = config?.otherLogTypeAssignments?.find((assignment) => assignment.logType === event.logType);
  if (mapped?.subsystem?.trim()) return mapped.subsystem.trim();

  return 'Other';
};

export type EventsBySubsystem = Record<string, GenericEvent[]>;

export const groupEventsBySubsystem = (events: GenericEvent[], config?: SubsystemConfig): EventsBySubsystem => {
  const result: EventsBySubsystem = {};
  getConfiguredSubsystems(config).forEach((subsystem) => {
    result[subsystem] = [];
  });

  events.forEach((event: GenericEvent): void => {
    const subsystem = resolveSubsystemForEvent(event, config);
    if (!result[subsystem]) result[subsystem] = [];
    result[subsystem].push(event);
  });

  return result;
};

export const getSubsystemLabel = (subsystem: string) => DEFAULT_SUBSYSTEM_LABELS[subsystem] ?? subsystem;

export const getSubsystemColor = (subsystem: string, index = 0) => {
  if (DEFAULT_SUBSYSTEM_COLORS[subsystem]) return DEFAULT_SUBSYSTEM_COLORS[subsystem];
  return CUSTOM_COLOR_CYCLE[index % CUSTOM_COLOR_CYCLE.length];
};
