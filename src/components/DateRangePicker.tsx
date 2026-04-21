import { format, parseISO, subDays, subMonths } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface DateRangePickerProps {
  dateRange: { from: Date; to: Date };
  onDateRangeChange: (range: { from: Date; to: Date }) => void;
}

/**
 * Executes `DateRangePicker`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export const DateRangePicker = ({ dateRange, onDateRangeChange }: DateRangePickerProps) => {
  const presets = [
    { label: '7 Days', value: () => ({ from: subDays(new Date(), 7), to: new Date() }) },
    { label: '14 Days', value: () => ({ from: subDays(new Date(), 14), to: new Date() }) },
    { label: '30 Days', value: () => ({ from: subDays(new Date(), 30), to: new Date() }) },
    { label: '2 Months', value: () => ({ from: subMonths(new Date(), 2), to: new Date() }) },
    { label: '3 Months', value: () => ({ from: subMonths(new Date(), 3), to: new Date() }) },
  ];

  /**
   * Executes `handlePresetClick`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const handlePresetClick = (getValue: () => { from: Date; to: Date }) => {
    onDateRangeChange(getValue());
  };

  /**
   * Executes `handleStartDateChange`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const handleStartDateChange = (value: string) => {
    if (!value) return;
    const nextStart = parseISO(value);
    const nextEnd = nextStart > dateRange.to ? nextStart : dateRange.to;
    onDateRangeChange({ from: nextStart, to: nextEnd });
  };

  /**
   * Executes `handleEndDateChange`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const handleEndDateChange = (value: string) => {
    if (!value) return;
    const nextEnd = parseISO(value);
    const nextStart = nextEnd < dateRange.from ? nextEnd : dateRange.from;
    onDateRangeChange({ from: nextStart, to: nextEnd });
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 bg-surface rounded-lg p-1">
        {presets.map(preset => (
          <Button
            key={preset.label}
            variant="ghost"
            size="sm"
            onClick={() => handlePresetClick(preset.value)}
            className="text-xs hover:bg-primary/10 hover:text-primary"
          >
            {preset.label}
          </Button>
        ))}
      </div>
      
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-2">
        <CalendarIcon className="h-4 w-4 text-muted-foreground" />
        <Input
          type="date"
          value={format(dateRange.from, 'yyyy-MM-dd')}
          max={format(dateRange.to, 'yyyy-MM-dd')}
          onChange={(e) => handleStartDateChange(e.target.value)}
          className="h-8 w-[150px]"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type="date"
          value={format(dateRange.to, 'yyyy-MM-dd')}
          min={format(dateRange.from, 'yyyy-MM-dd')}
          onChange={(e) => handleEndDateChange(e.target.value)}
          className="h-8 w-[150px]"
        />
      </div>
    </div>
  );
};
