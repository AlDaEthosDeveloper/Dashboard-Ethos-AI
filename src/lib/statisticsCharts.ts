import { format } from 'date-fns';
import { EVENT_LOG_TYPES } from '@/data/eventLogTypes';
import { GenericEvent } from '@/data/genericEventData';

export interface StatsPoint {
  timestamp: Date;
  timestampMs: number;
  label: string;
  minValue?: number;
  maxValue?: number;
  avgValue?: number;
}

export interface StatsSeries {
  key: string;
  label: string;
  points: StatsPoint[];
}

export interface MagnetronArcsPoint {
  date: Date;
  dateMs: number;
  label: string;
  arcs: number;
}

export interface MagnetronArcsSeries {
  points: MagnetronArcsPoint[];
  totalArcCount: number;
}

export interface SeriesDisplayOptions {
  showMin: boolean;
  showMax: boolean;
  showAvg: boolean;
  dailyAggregation: boolean;
}

export interface YAxisConfig {
  domain: [number, number];
  ticks: number[];
  axisMin: number;
  axisMax: number;
  majorTickStep: number;
}

export interface CountYAxisConfig {
  domain: [number, number];
  ticks: number[];
}

export const roundToOneDecimal = (value: number): number => Math.round(value * 10) / 10;

const isMultipleOfStep = (value: number, step: number): boolean => {
  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-6;
};

const getTickSteps = (range: number): { major: number; minor: number } => {
  if (range >= 38) return { major: 20, minor: 10 };
  if (range >= 18) return { major: 10, minor: 5 };
  if (range >= 8) return { major: 5, minor: 1 };
  if (range >= 4) return { major: 2, minor: 1 };
  if (range >= 2) return { major: 1, minor: 0.5 };
  return { major: 1, minor: 0.5 };
};

export const formatYAxisTick = (value: number, yAxis: YAxisConfig): string => {
  const rounded = roundToOneDecimal(value);
  if (rounded === yAxis.axisMin || rounded === yAxis.axisMax || isMultipleOfStep(rounded, yAxis.majorTickStep)) {
    return rounded.toFixed(1);
  }
  return '';
};

const pickNiceStep = (roughStep: number): number => {
  if (!Number.isFinite(roughStep) || roughStep <= 0) return 1;
  const baseCandidates = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 60, 80];
  const exponent = Math.floor(Math.log10(roughStep));
  const base = 10 ** Math.max(0, exponent);

  for (const candidate of baseCandidates) {
    const step = candidate * base;
    if (step >= roughStep) return step;
  }

  return 100 * base;
};

export const buildCountYAxis = (maxValue: number, desiredIntervals = 4): CountYAxisConfig => {
  const sanitizedMax = Number.isFinite(maxValue) ? Math.max(0, Math.round(maxValue)) : 0;
  const roughStep = sanitizedMax > 0 ? sanitizedMax / Math.max(1, desiredIntervals) : 1;
  const step = pickNiceStep(roughStep);
  const axisMax = Math.max(step, Math.ceil(sanitizedMax / step) * step);
  const ticks: number[] = [];

  for (let value = 0; value <= axisMax; value += step) {
    ticks.push(value);
  }

  return {
    domain: [0, axisMax],
    ticks,
  };
};

/** Returns true if the event is a logStatistics message (used for charts, not faults). */
export const isStatisticsEvent = (event: GenericEvent): boolean => {
  const msg = event.rawData?.fullMessage || event.description || '';
  return /logStatistics\s+\w+:/i.test(msg);
};

/** Filter out statistics events from an EventsByType record. */
export const filterOutStatisticsEvents = (eventsByType: Record<string, GenericEvent[]>): Record<string, GenericEvent[]> => {
  const result: Record<string, GenericEvent[]> = {};
  for (const [type, events] of Object.entries(eventsByType)) {
    result[type] = (events || []).filter(e => !isStatisticsEvent(e));
  }
  return result;
};

const parseNumber = (message: string, key: 'min' | 'max' | 'avg'): number | undefined => {
  const match = message.match(new RegExp(`${key}=([-+]?\\d*\\.?\\d+)`, 'i'));
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : undefined;
};

const getSeriesKey = (message: string): string | null => {
  const match = message.match(/logStatistics\s+([A-Za-z0-9_]+):/i);
  return match?.[1] || null;
};

export const extractStatisticsSeries = (filteredEvents: Record<string, GenericEvent[]>): StatsSeries[] => {
  const byKey = new Map<string, StatsPoint[]>();

  EVENT_LOG_TYPES.forEach((type) => {
    (filteredEvents[type] || []).forEach((event) => {
      const message = event.rawData?.fullMessage || event.description || '';
      const key = getSeriesKey(message);
      if (!key) return;

      const minValue = event.min ?? parseNumber(message, 'min');
      const maxValue = event.max ?? parseNumber(message, 'max');
      const avgValue = event.avg ?? parseNumber(message, 'avg');
      if (minValue == null && maxValue == null && avgValue == null) return;

      const arr = byKey.get(key) || [];
      arr.push({
        timestamp: event.timestamp,
        timestampMs: event.timestamp.getTime(),
        label: format(event.timestamp, 'MMM dd, HH:mm'),
        minValue: minValue != null ? roundToOneDecimal(minValue) : undefined,
        maxValue: maxValue != null ? roundToOneDecimal(maxValue) : undefined,
        avgValue: avgValue != null ? roundToOneDecimal(avgValue) : undefined,
      });
      byKey.set(key, arr);
    });
  });

  return Array.from(byKey.entries())
    .map(([key, points]) => ({
      key,
      label: key,
      points: points.sort((a, b) => a.timestampMs - b.timestampMs),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
};

export const aggregateSeriesDaily = (points: StatsPoint[]): StatsPoint[] => {
  const byDay = new Map<string, { timestamp: Date; min?: number; max?: number; avgTotal: number; avgCount: number }>();

  points.forEach((point) => {
    const dayKey = format(point.timestamp, 'yyyy-MM-dd');
    const existing = byDay.get(dayKey) || {
      timestamp: new Date(`${dayKey}T00:00:00`),
      min: undefined,
      max: undefined,
      avgTotal: 0,
      avgCount: 0,
    };

    if (point.minValue != null) existing.min = existing.min == null ? point.minValue : Math.min(existing.min, point.minValue);
    if (point.maxValue != null) existing.max = existing.max == null ? point.maxValue : Math.max(existing.max, point.maxValue);
    if (point.avgValue != null) {
      existing.avgTotal += point.avgValue;
      existing.avgCount += 1;
    }

    byDay.set(dayKey, existing);
  });

  return Array.from(byDay.values())
    .map((d) => ({
      timestamp: d.timestamp,
      timestampMs: d.timestamp.getTime(),
      label: format(d.timestamp, 'MMM dd'),
      minValue: d.min != null ? roundToOneDecimal(d.min) : undefined,
      maxValue: d.max != null ? roundToOneDecimal(d.max) : undefined,
      avgValue: d.avgCount > 0 ? roundToOneDecimal(d.avgTotal / d.avgCount) : undefined,
    }))
    .sort((a, b) => a.timestampMs - b.timestampMs);
};

export const buildYAxis = (points: StatsPoint[], opts: SeriesDisplayOptions): YAxisConfig => {
  const vals: number[] = [];
  points.forEach((p) => {
    if (opts.showMin && p.minValue != null) vals.push(p.minValue);
    if (opts.showMax && p.maxValue != null) vals.push(p.maxValue);
    if (opts.showAvg && p.avgValue != null) vals.push(p.avgValue);
  });
  if (vals.length === 0) {
    return { domain: [0, 1], ticks: [0, 0.5, 1], axisMin: 0, axisMax: 1, majorTickStep: 1 };
  }

  const dataMin = Math.min(...vals);
  const dataMax = Math.max(...vals);
  const rawRange = Math.max(dataMax - dataMin, 1);
  const { major, minor } = getTickSteps(rawRange);

  const roundedMin = Math.floor(dataMin / major) * major;
  const roundedMax = Math.ceil(dataMax / major) * major;
  const start = roundToOneDecimal(roundedMin - major) * major;
  const end = roundToOneDecimal(roundedMax + major) * major;

const ticks: number[] = [];
for (let v = roundedMin; v <= roundedMax + 1e-9; v += minor) {
  ticks.push(roundToOneDecimal(v));
}
const padding = minor * 0.5;

const domainStart = roundToOneDecimal(roundedMin - padding);
const domainEnd   = roundToOneDecimal(roundedMax + padding);

  return {
  domain: [domainStart, domainEnd],
  ticks,
  axisMin: roundedMin,
  axisMax: roundedMax,
  majorTickStep: major
};;
};

const isMagnetronArcEvent = (event: GenericEvent): boolean => {
  if (event.count == null) return false;
  const msg = `${event.rawData?.fullMessage || ''} ${event.description || ''}`.toLowerCase();
  return msg.includes('beamodometers') && msg.includes('arccount');
};

export const extractMagnetronArcsSeries = (filteredEvents: Record<string, GenericEvent[]>): MagnetronArcsSeries | null => {
  const arcEvents = Object.values(filteredEvents)
    .flatMap((events) => events || [])
    .filter(isMagnetronArcEvent)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  if (arcEvents.length < 2) return null;

  const dayStarts = new Map<string, { timestamp: Date; count: number }>();
  arcEvents.forEach((event) => {
    if (event.count == null) return;
    const dayKey = format(event.timestamp, 'yyyy-MM-dd');
    const existing = dayStarts.get(dayKey);

    if (!existing || event.timestamp.getTime() < existing.timestamp.getTime()) {
      dayStarts.set(dayKey, { timestamp: event.timestamp, count: event.count });
    }
  });

  const dayPoints = Array.from(dayStarts.values()).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  if (dayPoints.length < 2) return null;

  const points: MagnetronArcsPoint[] = [];
  for (let i = 0; i < dayPoints.length - 1; i++) {
    const current = dayPoints[i];
    const next = dayPoints[i + 1];
    const arcs = Math.max(0, next.count - current.count);

    points.push({
      date: current.timestamp,
      dateMs: current.timestamp.getTime(),
      label: format(current.timestamp, 'MMM dd'),
      arcs,
    });
  }

  if (points.length === 0) return null;

  return {
    points,
    totalArcCount: dayPoints[dayPoints.length - 1].count,
  };
};
