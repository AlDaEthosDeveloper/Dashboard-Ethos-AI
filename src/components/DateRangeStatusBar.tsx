import { useDashboard } from '@/contexts/DashboardContext';
import { DateRangePicker } from '@/components/DateRangePicker';

interface DateRangeStatusBarProps {
  compact?: boolean;
}

export const DateRangeStatusBar = ({ compact = false }: DateRangeStatusBarProps) => {
  const { dateRange, setDateRange, selectedMachine, machineLastRunStatusByMachine } = useDashboard();
  const status = machineLastRunStatusByMachine[selectedMachine];

  let isStale = false;

  if (status?.timestamp) {
    const lastRun = new Date(status.timestamp).getTime();
    const now = Date.now();
    const diffMinutes = (now - lastRun) / (1000 * 60);

    isStale = diffMinutes > 20;
  }

  return (
    <div className={`flex items-center ${compact ? 'gap-2' : 'gap-3'} flex-wrap`}>
      <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} />

      <div
        className={`rounded-lg border border-border bg-card px-3 py-2 text-xs ${
          isStale ? 'text-red-500' : 'text-muted-foreground'
        }`}
      >
        <span className="font-medium text-foreground">
          Machine last copy run:
        </span>{' '}
        {status?.timestamp || 'N/A'}
      </div>
    </div>
  );
};
