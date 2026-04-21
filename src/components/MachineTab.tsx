import { useState, useMemo, useCallback } from 'react';
import { Activity, AlertTriangle, Cpu, TrendingUp, Trash2 } from 'lucide-react';
import { subMonths, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { MLCError, MotorReplacement, MachineId } from '@/data/mlcErrorData';
import { GenericEvent } from '@/data/genericEventData';
import { EventLogType, EVENT_LOG_TYPES } from '@/data/eventLogTypes';
import { EventsByType } from '@/hooks/useEventLogData';
import { MLCHeatmap } from '@/components/MLCHeatmap';
import { StatsCard } from '@/components/StatsCard';
import { ErrorTimeline } from '@/components/ErrorTimeline';
import { ErrorTable } from '@/components/ErrorTable';
import { DateRangePicker } from '@/components/DateRangePicker';
import { TopMotorsChart } from '@/components/TopMotorsChart';
import { ExcelUpload } from '@/components/ExcelUpload';
import { LogFileUpload } from '@/components/LogFileUpload';
import { MotorReplacementForm } from '@/components/MotorReplacementForm';
import { GroupingSettings } from '@/components/GroupingSettings';
import { AlertSettings } from '@/components/AlertSettings';
import { ComparisonView } from '@/components/ComparisonView';
import { ExportData } from '@/components/ExportData';
import { EventLogTabs } from '@/components/EventLogTabs';
import { CorrelatedEvents } from '@/components/CorrelatedEvents';
import { Button } from '@/components/ui/button';
import { buildMotorTrendMap, getWorstMotorByBank } from '@/lib/mlcInsights';
import { useAppConfig } from '@/contexts/AppConfigContext';

interface MachineTabProps {
  machineId: MachineId;
  errors: MLCError[];
  rawErrors?: MLCError[];
  replacements: MotorReplacement[];
  eventsByType: EventsByType;
  onAddErrors: (errors: MLCError[]) => void;
  onAddReplacement: (replacement: MotorReplacement) => void;
  onRemoveReplacement: (replacementId: string) => void;
  onClearData: () => void;
  onClearEvents: (logType: EventLogType) => void;
  groupingWindowSeconds: number;
  onGroupingWindowChange: (seconds: number) => void;
}

/**
 * Executes `MachineTab`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export const MachineTab = ({
  machineId,
  errors,
  rawErrors,
  replacements,
  eventsByType,
  onAddErrors,
  onAddReplacement,
  onRemoveReplacement,
  onClearData,
  onClearEvents,
  groupingWindowSeconds,
  onGroupingWindowChange,
}: MachineTabProps) => {
  const { config } = useAppConfig();
  const [dateRange, setDateRange] = useState(() => {
    if (errors.length > 0) {
      const dates = errors.map(e => e.timestamp.getTime());
      return {
        from: new Date(Math.min(...dates)),
        to: new Date(Math.max(...dates)),
      };
    }
    return {
      from: subMonths(new Date(), 2),
      to: new Date(),
    };
  });
  const [selectedMotors, setSelectedMotors] = useState<Array<{ motor: number; bank: 'A' | 'B' }>>([]);

  // Filter errors by date range
  const filteredErrors = useMemo(() => {
    return errors.filter(error => 
      isWithinInterval(error.timestamp, {
        start: startOfDay(dateRange.from),
        end: endOfDay(dateRange.to),
      })
    );
  }, [dateRange, errors]);
  const handleMotorSelection = useCallback(
    (selection: { motor: number; bank: 'A' | 'B' }, options?: { ctrlKey?: boolean; shiftKey?: boolean }) => {
      const selectionKey = `${selection.motor}-${selection.bank}`;

      setSelectedMotors(previous => {
        const hasSelection = previous.some(item => `${item.motor}-${item.bank}` === selectionKey);

        if (options?.shiftKey && previous.length > 0) {
          const lastSelected = previous[previous.length - 1];
          if (lastSelected.bank === selection.bank) {
            const start = Math.min(lastSelected.motor, selection.motor);
            const end = Math.max(lastSelected.motor, selection.motor);
            const rangeSelections = Array.from({ length: end - start + 1 }, (_, index) => ({
              motor: start + index,
              bank: selection.bank,
            }));

            if (options?.ctrlKey) {
              const merged = new Map(previous.map(item => [`${item.motor}-${item.bank}`, item] as const));
              rangeSelections.forEach(item => merged.set(`${item.motor}-${item.bank}`, item));
              return Array.from(merged.values());
            }

            return rangeSelections;
          }
        }

        if (options?.ctrlKey) {
          if (hasSelection) {
            return previous.filter(item => `${item.motor}-${item.bank}` !== selectionKey);
          }
          return [...previous, selection];
        }

        if (hasSelection && previous.length === 1) {
          return [];
        }

        return [selection];
      });
    },
    []
  );


  // Calculate stats
  const stats = useMemo(() => {
    const totalErrors = filteredErrors.length;
    const bankAErrors = filteredErrors.filter(e => e.bank === 'A').length;
    const bankBErrors = filteredErrors.filter(e => e.bank === 'B').length;
    const hardErrors = filteredErrors.filter(e => e.isHardError).length;
    const replacementErrors = filteredErrors.filter(e => e.isMotorReplacement).length;
    
    const uniqueMotors = new Set(filteredErrors.map(e => e.mlcMotor)).size;
    
    const worstMotorsByBank = getWorstMotorByBank(filteredErrors, replacements);

    return {
      totalErrors,
      bankAErrors,
      bankBErrors,
      hardErrors,
      replacementErrors,
      uniqueMotors,
      worstMotorsByBank,
    };
  }, [filteredErrors, replacements]);

  const motorTrendMap = useMemo(
    () => buildMotorTrendMap(filteredErrors, replacements, config.mlcTrendSettings),
    [filteredErrors, replacements, config.mlcTrendSettings],
  );

  // Check if there are any other events
  const totalOtherEvents = useMemo(() => {
    return EVENT_LOG_TYPES.filter(t => t !== 'COL').reduce((sum, type) => sum + (eventsByType[type]?.length || 0), 0);
  }, [eventsByType]);

  // Track correlated event IDs from MLC errors
  const [correlatedEventIds, setCorrelatedEventIds] = useState<Set<string>>(new Set());
  const [mlcCorrelationWindowMs, setMlcCorrelationWindowMs] = useState(60000);

  const handleCorrelatedEventIds = useCallback((ids: Set<string>) => {
    setCorrelatedEventIds(ids);
  }, []);

  /**
   * Executes `handleDataLoaded`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const handleDataLoaded = (newData: MLCError[]) => {
    onAddErrors(newData);
    // Adjust date range to fit new data
    if (newData.length > 0) {
      const allErrors = [...errors, ...newData];
      const dates = allErrors.map(e => e.timestamp.getTime());
      const minDate = new Date(Math.min(...dates));
      const maxDate = new Date(Math.max(...dates));
      setDateRange({ from: minDate, to: maxDate });
    }
  };

  return (
    <div className="space-y-8">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <ExcelUpload machineId={machineId} onDataLoaded={handleDataLoaded} />
          <LogFileUpload machineId={machineId} onDataLoaded={(_mid, data) => handleDataLoaded(data)} />
          <MotorReplacementForm
            machineId={machineId}
            replacements={replacements}
            errors={errors}
            onAddReplacement={onAddReplacement}
            onRemoveReplacement={onRemoveReplacement}
          />
          <GroupingSettings
            groupingWindowSeconds={groupingWindowSeconds}
            onGroupingWindowChange={onGroupingWindowChange}
          />
          <AlertSettings errors={errors} replacements={replacements} />
          <ComparisonView errors={errors} replacements={replacements} />
          <ExportData 
            machineId={machineId} 
            errors={filteredErrors} 
            replacements={replacements}
            rawErrors={rawErrors}
            eventsByType={eventsByType}
          />
          {errors.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearData}
              className="gap-2 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
              Clear Data
            </Button>
          )}
        </div>
        <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} />
      </div>

      {errors.length === 0 && totalOtherEvents === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Cpu className="w-16 h-16 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No Data for {machineId}</h3>
          <p className="text-muted-foreground max-w-md">
            Upload an Excel file or scan a folder to start analyzing MLC motor errors for this machine.
          </p>
        </div>
      ) : errors.length === 0 && totalOtherEvents > 0 ? (
        // Show only EventLogTabs when no MLC errors but other events exist
        <div className="space-y-6">
          <div className="flex flex-col items-center justify-center py-12 text-center bg-muted/30 rounded-lg">
            <Cpu className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <h3 className="text-base font-medium text-foreground mb-1">No MLC Errors for {machineId}</h3>
            <p className="text-sm text-muted-foreground">
              But {totalOtherEvents} other events were found in the logs.
            </p>
          </div>
          <EventLogTabs eventsByType={eventsByType} onClearEvents={onClearEvents} correlatedEventIds={new Set()} />
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard
              title="Total Errors"
              value={stats.totalErrors}
              subtitle={`${stats.hardErrors} hard errors, ${stats.replacementErrors} from replacements`}
              icon={AlertTriangle}
              variant="danger"
            />
            <StatsCard
              title="Bank A Errors"
              value={stats.bankAErrors}
              subtitle={`${((stats.bankAErrors / stats.totalErrors) * 100 || 0).toFixed(1)}% of total`}
              icon={Activity}
              variant="primary"
            />
            <StatsCard
              title="Bank B Errors"
              value={stats.bankBErrors}
              subtitle={`${((stats.bankBErrors / stats.totalErrors) * 100 || 0).toFixed(1)}% of total`}
              icon={Activity}
              variant="primary"
            />
            <StatsCard
              title="Most Problematic"
              value={
                stats.worstMotorsByBank.A || stats.worstMotorsByBank.B
                  ? `A: ${stats.worstMotorsByBank.A ? `M${stats.worstMotorsByBank.A.motor}` : 'N/A'} • B: ${stats.worstMotorsByBank.B ? `M${stats.worstMotorsByBank.B.motor}` : 'N/A'}`
                  : 'N/A'
              }
              subtitle={
                stats.worstMotorsByBank.A || stats.worstMotorsByBank.B
                  ? `A: ${stats.worstMotorsByBank.A?.count || 0} errors • B: ${stats.worstMotorsByBank.B?.count || 0} errors`
                  : 'No active motor errors'
              }
              icon={TrendingUp}
              variant="warning"
            />
          </div>

          {/* Heatmap */}
          <div className="bg-card rounded-xl border border-border p-6">
            <MLCHeatmap 
              errors={filteredErrors} 
              replacements={replacements}
              trendMap={motorTrendMap}
              selectedMotors={selectedMotors}
              onMotorSelect={handleMotorSelection}
            />
          </div>
      
           {/* Charts Grid */}
           <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ErrorTimeline errors={filteredErrors} dateRange={dateRange} selectedMotors={selectedMotors} />
              <TopMotorsChart errors={filteredErrors} replacements={replacements} />
           </div>

          {/* Correlated Events */}
          <CorrelatedEvents 
            mlcErrors={filteredErrors} 
            eventsByType={eventsByType} 
            windowMs={mlcCorrelationWindowMs}
            onWindowChange={setMlcCorrelationWindowMs}
            onCorrelatedEventIds={handleCorrelatedEventIds}
          />

          {/* Error Table */}
          <ErrorTable errors={filteredErrors} selectedMotors={selectedMotors} replacements={replacements} />

          {/* Other Event Logs */}
          <EventLogTabs eventsByType={eventsByType} onClearEvents={onClearEvents} correlatedEventIds={correlatedEventIds} />
        </>
      )}
    </div>
  );
};
