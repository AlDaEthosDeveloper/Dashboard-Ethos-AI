import { useState, useEffect, useCallback } from 'react';
import { MachineId, getMachineIds } from '@/data/mlcErrorData';
import { GenericEvent, mergeEvents } from '@/data/genericEventData';
import { EventLogType, EVENT_LOG_TYPES } from '@/data/eventLogTypes';

const STORAGE_KEY = 'mlc-dashboard-events';

export type EventsByType = Record<EventLogType, GenericEvent[]>;
type EventsByMachine = Record<string, EventsByType>;

interface StoredEventData {
  machines: Record<string, Record<EventLogType, Array<{
    id: string;
    timestamp: string;
    machineSerial: string;
    logType: EventLogType;
    eventCode: string;
    component: string;
    description: string;
    severity: 'Info' | 'Warning' | 'Error' | 'Critical';
    data1?: number;
    data2?: number;
    rawData?: Record<string, string>;
  }>>>;
}

/**
 * Creates an empty event bucket for every known log type.
 *
 * @returns Empty event map keyed by `EventLogType`.
 */
const createEmptyEventsByType = (): EventsByType => {
  const result = {} as EventsByType;
  EVENT_LOG_TYPES.forEach(type => {
    result[type] = [];
  });
  return result;
};

/**
 * Creates initial event storage for all configured machines.
 *
 * @returns Machine-keyed event data initialized with empty buckets.
 */
const createInitialData = (): EventsByMachine => {
  const result: EventsByMachine = {};
  getMachineIds().forEach(id => {
    result[id] = createEmptyEventsByType();
  });
  return result;
};

/**
 * Serializes in-memory event data for localStorage persistence.
 *
 * @param data In-memory event data.
 * @returns JSON-safe event payload.
 */
const serializeEventData = (data: EventsByMachine): StoredEventData => {
  const result: StoredEventData = { machines: {} };
  
  Object.keys(data).forEach(id => {
    result.machines[id] = {} as Record<EventLogType, any>;
    EVENT_LOG_TYPES.forEach(type => {
      result.machines[id][type] = (data[id]?.[type] || []).map(e => ({
        ...e,
        timestamp: e.timestamp.toISOString(),
      }));
    });
  });
  
  return result;
};

/**
 * Restores persisted event data from localStorage shape.
 *
 * @param stored JSON-deserialized persisted payload.
 * @returns In-memory event data with restored `Date` instances.
 */
const deserializeEventData = (stored: StoredEventData): EventsByMachine => {
  const result = createInitialData();
  
  Object.keys(stored.machines).forEach(id => {
    const machineData = stored.machines[id];
    if (machineData) {
      if (!result[id]) result[id] = createEmptyEventsByType();
      EVENT_LOG_TYPES.forEach(type => {
        const typeData = machineData[type];
        if (typeData) {
          result[id][type] = typeData.map(e => ({
            ...e,
            timestamp: new Date(e.timestamp),
            machineSerial: e.machineSerial as MachineId,
          }));
        }
      });
    }
  });
  
  return result;
};

/**
 * Provides machine-scoped generic event storage operations.
 *
 * @returns Event state and mutation helpers.
 */
export const useEventLogData = () => {
  const [eventData, setEventData] = useState<EventsByMachine>(createInitialData);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as StoredEventData;
        setEventData(deserializeEventData(parsed));
      }
    } catch (error) {
      console.error('Failed to load event data from localStorage:', error);
    }
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (isLoaded) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeEventData(eventData)));
      } catch (error) {
        console.error('Failed to save event data to localStorage:', error);
      }
    }
  }, [eventData, isLoaded]);

  const addEvents = useCallback((machineId: MachineId, logType: EventLogType, newEvents: GenericEvent[]) => {
    setEventData(prev => {
      const machineEvents = prev[machineId] || createEmptyEventsByType();
      const current = machineEvents[logType] || [];
      const merged = mergeEvents(current, newEvents);
      
      return {
        ...prev,
        [machineId]: {
          ...machineEvents,
          [logType]: merged,
        },
      };
    });
  }, []);

  const clearEventData = useCallback((machineId: MachineId, logType?: EventLogType) => {
    setEventData(prev => {
      if (logType) {
        return {
          ...prev,
          [machineId]: {
            ...(prev[machineId] || createEmptyEventsByType()),
            [logType]: [],
          },
        };
      }
      return {
        ...prev,
        [machineId]: createEmptyEventsByType(),
      };
    });
  }, []);

  const getEventCount = useCallback((machineId: MachineId, logType?: EventLogType): number => {
    const machineEvents = eventData[machineId];
    if (!machineEvents) return 0;
    if (logType) {
      return (machineEvents[logType] || []).length;
    }
    return EVENT_LOG_TYPES.reduce((sum, type) => sum + (machineEvents[type] || []).length, 0);
  }, [eventData]);

  const getEventsByType = useCallback((machineId: MachineId): EventsByType => {
    return eventData[machineId] || createEmptyEventsByType();
  }, [eventData]);

  return {
    eventData,
    isLoaded,
    addEvents,
    clearEventData,
    getEventCount,
    getEventsByType,
  };
};
