import { useMemo } from 'react';
import { FileText, AlertTriangle, Activity, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MachineId, getMachineIds, MLCError } from '@/data/mlcErrorData';
import { GenericEvent } from '@/data/genericEventData';
import { EventLogType, EVENT_LOG_TYPES, EVENT_LOG_TYPE_LABELS, EVENT_LOG_TYPE_COLORS } from '@/data/eventLogTypes';
import { EventsByType } from '@/hooks/useEventLogData';
import { cn } from '@/lib/utils';

interface ImportSummaryProps {
  machineErrors: Record<MachineId, MLCError[]>;
  machineEvents: Record<MachineId, EventsByType>;
  onDismiss?: () => void;
}

interface MachineSummary {
  machineId: MachineId;
  mlcErrorCount: number;
  hardErrorCount: number;
  eventCounts: Record<EventLogType, number>;
  totalEvents: number;
}

/**
 * Executes `ImportSummary`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export const ImportSummary = ({ machineErrors, machineEvents, onDismiss }: ImportSummaryProps) => {
  const summaries = useMemo<MachineSummary[]>(() => {
    return getMachineIds().map(machineId => {
      const errors = machineErrors[machineId] || [];
      const events = machineEvents[machineId] || {} as EventsByType;
      
      const eventCounts = {} as Record<EventLogType, number>;
      let totalEvents = 0;
      
      EVENT_LOG_TYPES.forEach(type => {
        const count = events[type]?.length || 0;
        eventCounts[type] = count;
        if (type !== 'COL') {
          totalEvents += count;
        }
      });

      return {
        machineId,
        mlcErrorCount: errors.length,
        hardErrorCount: errors.filter(e => e.isHardError).length,
        eventCounts,
        totalEvents,
      };
    }).filter(s => s.mlcErrorCount > 0 || s.totalEvents > 0);
  }, [machineErrors, machineEvents]);

  const totalMlcErrors = useMemo(() => 
    summaries.reduce((sum, s) => sum + s.mlcErrorCount, 0),
  [summaries]);

  const totalHardErrors = useMemo(() => 
    summaries.reduce((sum, s) => sum + s.hardErrorCount, 0),
  [summaries]);

  const totalOtherEvents = useMemo(() => 
    summaries.reduce((sum, s) => sum + s.totalEvents, 0),
  [summaries]);

  if (summaries.length === 0) {
    return null;
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Import Summary</CardTitle>
          </div>
          {onDismiss && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onDismiss}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Totals */}
        <div className="flex flex-wrap gap-3">
          <Badge variant="outline" className="gap-1.5 py-1 px-2.5">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            <span>{totalMlcErrors} MLC Errors</span>
            {totalHardErrors > 0 && (
              <span className="text-destructive">({totalHardErrors} hard)</span>
            )}
          </Badge>
          <Badge variant="outline" className="gap-1.5 py-1 px-2.5">
            <Activity className="h-3.5 w-3.5 text-primary" />
            <span>{totalOtherEvents} Other Events</span>
          </Badge>
        </div>

        {/* Per-machine breakdown */}
        <div className="space-y-3">
          {summaries.map(summary => (
            <div 
              key={summary.machineId} 
              className="p-3 rounded-lg bg-background border border-border"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-foreground">{summary.machineId}</span>
                <div className="flex gap-2">
                  {summary.mlcErrorCount > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {summary.mlcErrorCount} MLC
                      {summary.hardErrorCount > 0 && (
                        <span className="text-destructive ml-1">({summary.hardErrorCount} hard)</span>
                      )}
                    </Badge>
                  )}
                </div>
              </div>
              
              {/* Event type breakdown */}
              {summary.totalEvents > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {EVENT_LOG_TYPES.filter(type => type !== 'COL' && summary.eventCounts[type] > 0).map(type => (
                    <Badge 
                      key={type} 
                      variant="outline" 
                      className="text-xs gap-1"
                    >
                      <span className={cn('w-1.5 h-1.5 rounded-full', EVENT_LOG_TYPE_COLORS[type])} />
                      {EVENT_LOG_TYPE_LABELS[type].split(' ')[0]}: {summary.eventCounts[type]}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
