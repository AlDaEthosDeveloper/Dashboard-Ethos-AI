import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { MLCError } from '@/data/mlcErrorData';
import { format, startOfDay, eachDayOfInterval } from 'date-fns';
import { buildCountYAxis } from '@/lib/statisticsCharts';

interface ErrorTimelineProps {
  errors: MLCError[];
  dateRange: { from: Date; to: Date };
  selectedMotors: Array<{ motor: number; bank: 'A' | 'B' }>;
  replacementDate?: Date;
  onDaySelect?: (day: Date) => void;
  compact?: boolean;
}

export const ErrorTimeline = ({
  errors,
  dateRange,
  selectedMotors,
  replacementDate,
  onDaySelect,
  compact = false,
}: ErrorTimelineProps) => {
  const filteredErrors = useMemo(() => {
    if (selectedMotors.length === 0) return errors;
    const selectedKeys = new Set(selectedMotors.map(selection => `${selection.motor}-${selection.bank}`));
    return errors.filter(error => selectedKeys.has(`${error.mlcMotor}-${error.bank}`));
  }, [errors, selectedMotors]);

  const chartData = useMemo(() => {
    const days = eachDayOfInterval({ start: dateRange.from, end: dateRange.to });

    const dailyCounts = new Map<string, { bankA: number; bankB: number }>();
    days.forEach(day => {
      dailyCounts.set(format(day, 'yyyy-MM-dd'), { bankA: 0, bankB: 0 });
    });

    filteredErrors.forEach(error => {
      const dayKey = format(startOfDay(error.timestamp), 'yyyy-MM-dd');
      const existing = dailyCounts.get(dayKey);
      if (existing) {
        if (error.bank === 'A') existing.bankA++;
        else existing.bankB++;
      }
    });

    return Array.from(dailyCounts.entries()).map(([date, counts]) => ({
      date,
      dateKey: date,
      displayDate: format(new Date(date), 'MMM dd, yyyy'),
      bankA: counts.bankA,
      bankB: counts.bankB,
      total: counts.bankA + counts.bankB,
      replacementDate,
    }));
  }, [filteredErrors, dateRange, replacementDate]);

  const yAxis = useMemo(() => {
    const maxTotal = chartData.reduce((max, entry) => Math.max(max, entry.total), 0);
    return buildCountYAxis(maxTotal);
  }, [chartData]);

  return (
    <div className={`h-full ${compact ? 'rounded border p-1' : 'bg-card rounded-xl border border-border p-3'}`}>
      <div className="flex h-full flex-col">
        <div className="mb-1 flex items-center justify-between gap-2 flex-wrap">
          <h3 className={`${compact ? 'text-[11px]' : 'text-lg'} font-medium`}>MLC errors</h3>
          <div className={`flex items-center ${compact ? 'gap-2 text-xs' : 'gap-4 text-sm'} flex-wrap`}>
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-cyan-600" />
              <span className="font-medium text-foreground">Bank A</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-lime-600" />
              <span className="font-medium text-foreground">Bank B</span>
            </div>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={compact ? 122 : 200}>
          <AreaChart
            data={chartData}
            onClick={(state) => {
              const dateKey = state?.activePayload?.[0]?.payload?.dateKey;
              if (dateKey && onDaySelect) {
                onDaySelect(startOfDay(new Date(dateKey)));
              }
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="displayDate" fontSize={compact ? 10 : 12} />
            <YAxis
              allowDecimals={false}
              fontSize={compact ? 10 : 12}
              width={compact ? 30 : 44}
              domain={yAxis.domain}
              ticks={yAxis.ticks}
              interval={0}
            />
            <Tooltip
              labelFormatter={(label) => format(new Date(String(label)), 'MMM dd, yyyy')}
              contentStyle={{
                backgroundColor: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                color: 'hsl(var(--popover-foreground))',
              }}
            />
            <Area type="monotone" dataKey="bankA" stackId="1" stroke="#0092b8" fill="#0092b8" />
            <Area type="monotone" dataKey="bankB" stackId="1" stroke="#5ea500" fill="#5ea500" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
