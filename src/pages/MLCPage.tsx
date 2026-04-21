import { useState, useMemo, useCallback } from 'react';
import { Activity, AlertTriangle, Cpu, TrendingUp } from 'lucide-react';
import { endOfDay, startOfDay } from 'date-fns';
import { useDashboard } from '@/contexts/DashboardContext';
import { StatsCard } from '@/components/StatsCard';
import { MLCHeatmap } from '@/components/MLCHeatmap';
import { ErrorTimeline } from '@/components/ErrorTimeline';
import { ErrorTable } from '@/components/ErrorTable';
import { TopMotorsChart } from '@/components/TopMotorsChart';
import { MotorReplacementForm } from '@/components/MotorReplacementForm';
import { GroupingSettings } from '@/components/GroupingSettings';
import { AlertSettings } from '@/components/AlertSettings';
import { ComparisonView } from '@/components/ComparisonView';
import { ExportData } from '@/components/ExportData';
import { CorrelatedEvents } from '@/components/CorrelatedEvents';
import { buildMotorTrendMap, getWorstMotorByBank } from '@/lib/mlcInsights';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { DateRangeStatusBar } from '@/components/DateRangeStatusBar';

/**
 * Executes `MLCPage`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
const MLCPage = () => {
  const { 
    selectedMachine,
    filteredErrors,
    filteredEvents,
    dateRange,
    setDateRange,
    machineData,
    getRawErrors,
    addReplacement,
    removeReplacement,
    groupingWindowSeconds,
    setGroupingWindowSeconds,
  } = useDashboard();
  const { config, getMachineLabel } = useAppConfig();
  const selectedMachineLabel = getMachineLabel(selectedMachine);
  
  const [selectedMotors, setSelectedMotors] = useState<Array<{ motor: number; bank: 'A' | 'B' }>>([]);
  const [showMotorErrorCounts, setShowMotorErrorCounts] = useState(true);
  const [correlatedEventIds, setCorrelatedEventIds] = useState<Set<string>>(new Set());
  const [mlcCorrelationWindowMs, setMlcCorrelationWindowMs] = useState(60000);
  
  const replacements = machineData[selectedMachine].replacements;
  const rawErrors = getRawErrors(selectedMachine);
  
  // Selected motor filter
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

  const handleTimelineDaySelect = useCallback(
    (day: Date) => {
      setDateRange({ from: startOfDay(day), to: endOfDay(day) });
    },
    [setDateRange]
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
  
  const handleCorrelatedEventIds = useCallback((ids: Set<string>) => {
    setCorrelatedEventIds(ids);
  }, []);
  
  return (
      
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">MLC Analysis for {selectedMachineLabel}</h2>
        </div>
        <DateRangeStatusBar />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
          <MotorReplacementForm
            machineId={selectedMachine}
            replacements={replacements}
            errors={machineData[selectedMachine].errors}
            onAddReplacement={(replacement) => addReplacement(selectedMachine, replacement)}
            onRemoveReplacement={(id) => removeReplacement(selectedMachine, id)}
          />
          <GroupingSettings
            groupingWindowSeconds={groupingWindowSeconds}
            onGroupingWindowChange={setGroupingWindowSeconds}
          />
          <AlertSettings errors={machineData[selectedMachine].errors} replacements={replacements} />
          <ComparisonView errors={machineData[selectedMachine].errors} replacements={replacements} />
          <ExportData 
            machineId={selectedMachine} 
            errors={filteredErrors} 
            replacements={replacements}
            rawErrors={rawErrors}
            eventsByType={filteredEvents}
          />
      </div>
      
      {filteredErrors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Cpu className="w-16 h-16 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No MLC Data for {selectedMachineLabel}</h3>
          <p className="text-muted-foreground max-w-md">
            Upload MLC error data via the Upload page to start analyzing motor errors.
          </p>
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
                  ? `A${stats.worstMotorsByBank.A ? `${stats.worstMotorsByBank.A.motor}` : 'N/A'} • B${stats.worstMotorsByBank.B ? `${stats.worstMotorsByBank.B.motor}` : 'N/A'}`
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
              showMotorErrorCounts={showMotorErrorCounts}
              onShowMotorErrorCountsChange={setShowMotorErrorCounts}
            />
          </div>
          
          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ErrorTimeline
              errors={filteredErrors}
              dateRange={dateRange}
              selectedMotors={selectedMotors}
              onDaySelect={handleTimelineDaySelect}
            />
            <TopMotorsChart errors={filteredErrors} replacements={replacements} />
          </div>
          
          {/* Correlated Events */}
          <CorrelatedEvents 
            mlcErrors={filteredErrors} 
            eventsByType={filteredEvents} 
            windowMs={mlcCorrelationWindowMs}
            onWindowChange={setMlcCorrelationWindowMs}
            onCorrelatedEventIds={handleCorrelatedEventIds}
          />
          
          {/* Error Table */}
          <ErrorTable errors={filteredErrors} selectedMotors={selectedMotors} replacements={replacements} />
        </>
      )}
    </div>
  );
};

export default MLCPage;
