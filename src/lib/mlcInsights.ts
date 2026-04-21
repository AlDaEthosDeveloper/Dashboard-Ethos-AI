import { addDays, differenceInCalendarDays, isWeekend, startOfDay } from 'date-fns';
import { MLCError, MotorReplacement } from '@/data/mlcErrorData';

export type MotorBank = 'A' | 'B';

export interface MotorSelectionKey {
  motor: number;
  bank: MotorBank;
}

export interface WorstMotorByBank {
  A: { motor: number; count: number } | null;
  B: { motor: number; count: number } | null;
}

export type MotorTrend = 'up' | 'down' | 'stable' | 'unknown' | 'hidden';

export interface MotorTrendSettings {
  minIncidentDaysForTrend: number;
  minIncidentDaysForDirection: number;
  rateDiffThreshold: number;
  intervalDiffThresholdDays: number;
}

export const DEFAULT_MOTOR_TREND_SETTINGS: MotorTrendSettings = {
  minIncidentDaysForTrend: 4,
  minIncidentDaysForDirection: 6,
  rateDiffThreshold: 0.12,
  intervalDiffThresholdDays: 3,
};

const getLastReplacementDate = (replacements: MotorReplacement[], motor: number, bank: MotorBank): Date | null => {
  const matches = replacements
    .filter((replacement) => replacement.mlcMotor === motor && replacement.bank === bank)
    .sort((a, b) => a.replacementDate.getTime() - b.replacementDate.getTime());

  return matches.length > 0 ? matches[matches.length - 1].replacementDate : null;
};

const getRelevantErrors = (errors: MLCError[], motor: number, bank: MotorBank, replacements: MotorReplacement[]) => {
  const selectionErrors = errors.filter((error) => error.mlcMotor === motor && error.bank === bank);
  const lastReplacementDate = getLastReplacementDate(replacements, motor, bank);

  if (!lastReplacementDate) {
    return { errors: selectionErrors, hasReplacement: false, hasErrorsAfterReplacement: false };
  }

  const errorsAfterReplacement = selectionErrors.filter((error) => error.timestamp > lastReplacementDate);

  return {
    errors: errorsAfterReplacement,
    hasReplacement: true,
    hasErrorsAfterReplacement: errorsAfterReplacement.length > 0,
  };
};

export const getWorstMotorByBank = (errors: MLCError[], replacements: MotorReplacement[]): WorstMotorByBank => {
  const counts: Record<MotorBank, Record<number, number>> = { A: {}, B: {} };

  for (let motor = 1; motor <= 57; motor++) {
    (['A', 'B'] as const).forEach((bank) => {
      const relevant = getRelevantErrors(errors, motor, bank, replacements);
      if (relevant.errors.length > 0) {
        counts[bank][motor] = relevant.errors.length;
      }
    });
  }

  const pickWorst = (bank: MotorBank) => {
    const entries = Object.entries(counts[bank]).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return null;
    return { motor: Number(entries[0][0]), count: entries[0][1] };
  };

  return {
    A: pickWorst('A'),
    B: pickWorst('B'),
  };
};

const getIncidentDays = (errors: MLCError[]) => {
  if (errors.length === 0) return [] as number[];

  return Array.from(new Set(errors.map((error) => startOfDay(error.timestamp).getTime()))).sort((a, b) => a - b);
};

const getWeekdaySeries = (errors: MLCError[]) => {
  if (errors.length === 0) return [] as Array<{ day: number; count: number }>;

  const dayCounts = new Map<number, number>();
  for (const error of errors) {
    const day = startOfDay(error.timestamp).getTime();
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }

  const sortedDays = Array.from(dayCounts.keys()).sort((a, b) => a - b);
  const start = sortedDays[0];
  const end = sortedDays[sortedDays.length - 1];
  const totalDays = differenceInCalendarDays(end, start) + 1;

  const weekdays = Array.from({ length: totalDays }, (_, index) => startOfDay(addDays(start, index)))
    .filter((day) => !isWeekend(day))
    .map((day) => day.getTime());

  return weekdays.map((day) => ({
    day,
    count: dayCounts.get(day) ?? 0,
  }));
};

const splitIntoHalves = <T>(series: T[]) => {
  const mid = Math.floor(series.length / 2);
  return {
    firstHalf: series.slice(0, mid),
    secondHalf: series.slice(mid),
  };
};

const getRateTrendSignal = (
  weekdaySeries: Array<{ day: number; count: number }>,
  rateDiffThreshold: number,
): MotorTrend | null => {
  if (weekdaySeries.length < 4) return null;

  const { firstHalf, secondHalf } = splitIntoHalves(weekdaySeries);
  if (firstHalf.length === 0 || secondHalf.length === 0) return null;

  const firstAvg = firstHalf.reduce((sum, day) => sum + day.count, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, day) => sum + day.count, 0) / secondHalf.length;
  const diff = secondAvg - firstAvg;

  if (Math.abs(diff) < rateDiffThreshold) return 'stable';
  return diff > 0 ? 'up' : 'down';
};

const getInterArrivalTrendSignal = (
  incidentDays: number[],
  intervalDiffThresholdDays: number,
): MotorTrend | null => {
  if (incidentDays.length < 4) return null;

  const intervals = incidentDays
    .slice(1)
    .map((day, index) => differenceInCalendarDays(day, incidentDays[index]));

  if (intervals.length < 3) return null;

  const { firstHalf, secondHalf } = splitIntoHalves(intervals);
  if (firstHalf.length === 0 || secondHalf.length === 0) return null;

  const firstAvg = firstHalf.reduce((sum, value) => sum + value, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, value) => sum + value, 0) / secondHalf.length;
  const diff = secondAvg - firstAvg;

  if (Math.abs(diff) < intervalDiffThresholdDays) return 'stable';
  return diff < 0 ? 'up' : 'down';
};

export const buildMotorTrendMap = (
  errors: MLCError[],
  replacements: MotorReplacement[],
  settings: Partial<MotorTrendSettings> = {},
): Record<string, MotorTrend> => {
  const resolvedSettings: MotorTrendSettings = {
    ...DEFAULT_MOTOR_TREND_SETTINGS,
    ...settings,
  };

  const minIncidentDaysForTrend = Math.max(2, Math.round(Number(resolvedSettings.minIncidentDaysForTrend)));
  const minIncidentDaysForDirection = Math.max(
    minIncidentDaysForTrend,
    Math.round(Number(resolvedSettings.minIncidentDaysForDirection)),
  );
  const rateDiffThreshold = Math.max(0, Number(resolvedSettings.rateDiffThreshold));
  const intervalDiffThresholdDays = Math.max(0, Number(resolvedSettings.intervalDiffThresholdDays));

  const trendMap: Record<string, MotorTrend> = {};

  for (let motor = 1; motor <= 57; motor++) {
    (['A', 'B'] as const).forEach((bank) => {
      const key = `${motor}-${bank}`;
      const relevant = getRelevantErrors(errors, motor, bank, replacements);

      if (relevant.hasReplacement && !relevant.hasErrorsAfterReplacement) {
        trendMap[key] = 'hidden';
        return;
      }

      if (relevant.errors.length === 0) {
        trendMap[key] = 'hidden';
        return;
      }

      const incidentDays = getIncidentDays(relevant.errors);
      if (incidentDays.length < minIncidentDaysForTrend) {
        trendMap[key] = 'unknown';
        return;
      }

      const weekdaySeries = getWeekdaySeries(relevant.errors);
      const rateSignal = getRateTrendSignal(weekdaySeries, rateDiffThreshold);
      const interArrivalSignal = getInterArrivalTrendSignal(incidentDays, intervalDiffThresholdDays);

      if (!rateSignal && !interArrivalSignal) {
        trendMap[key] = 'unknown';
        return;
      }

      if (rateSignal === 'stable' && interArrivalSignal === 'stable') {
        trendMap[key] = 'stable';
        return;
      }

      if (!rateSignal) {
        trendMap[key] = interArrivalSignal ?? 'unknown';
        return;
      }

      if (!interArrivalSignal) {
        trendMap[key] = rateSignal;
        return;
      }

      if (rateSignal === 'stable') {
        trendMap[key] = interArrivalSignal;
        return;
      }

      if (interArrivalSignal === 'stable') {
        trendMap[key] = rateSignal;
        return;
      }

      const resolvedTrend = rateSignal === interArrivalSignal ? rateSignal : 'stable';
      if (
        (resolvedTrend === 'up' || resolvedTrend === 'down') &&
        incidentDays.length < minIncidentDaysForDirection
      ) {
        trendMap[key] = 'stable';
        return;
      }

      trendMap[key] = resolvedTrend;
    });
  }

  return trendMap;
};
