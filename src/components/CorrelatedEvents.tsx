import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Link2, ChevronDown, ChevronRight, Clock, Settings2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MLCError } from '@/data/mlcErrorData';
import { GenericEvent } from '@/data/genericEventData';
import { EventLogType, EVENT_LOG_TYPE_LABELS, EVENT_LOG_TYPE_COLORS } from '@/data/eventLogTypes';
import { EventsByType } from '@/hooks/useEventLogData';
import { cn } from '@/lib/utils';

interface CorrelatedEventsProps {
  mlcErrors: MLCError[];
  eventsByType: EventsByType;
  windowMs?: number;
  onWindowChange?: (windowMs: number) => void;
  onCorrelatedEventIds?: (ids: Set<string>) => void;
}

interface CorrelatedGroup {
  mlcError: MLCError;
  correlatedEvents: Array<{
    event: GenericEvent;
    logType: EventLogType;
    timeDiffMs: number;
  }>;
}

/**
 * Executes `CorrelatedEvents`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export const CorrelatedEvents = ({ 
  mlcErrors, 
  eventsByType, 
  windowMs = 1000,
  onWindowChange,
  onCorrelatedEventIds,
}: CorrelatedEventsProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [localWindowMs, setLocalWindowMs] = useState(windowMs);
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const { correlatedGroups, correlatedEventIds } = useMemo(() => {
    const groups: CorrelatedGroup[] = [];
    const eventIds = new Set<string>();
    
    // Collect all events into a flat array with their type
    const allEvents: Array<{ event: GenericEvent; logType: EventLogType }> = [];
    Object.entries(eventsByType).forEach(([type, events]) => {
      if (type !== 'COL') {
        events.forEach(event => {
          allEvents.push({ event, logType: type as EventLogType });
        });
      }
    });

    // For each hard error, find correlated events
    mlcErrors.forEach(mlcError => {
      const errorTime = mlcError.timestamp.getTime();
      const correlated: CorrelatedGroup['correlatedEvents'] = [];

      allEvents.forEach(({ event, logType }) => {
        const eventTime = event.timestamp.getTime();
        const timeDiff = eventTime - errorTime;
        
        if (Math.abs(timeDiff) <= localWindowMs) {
          correlated.push({
            event,
            logType,
            timeDiffMs: timeDiff,
          });
          eventIds.add(event.id);
        }
      });

      if (correlated.length > 0) {
        // Sort by time difference (closest first)
        correlated.sort((a, b) => Math.abs(a.timeDiffMs) - Math.abs(b.timeDiffMs));
        groups.push({ mlcError, correlatedEvents: correlated });
      }
    });

    // Sort groups by most correlated events
    return {
      correlatedGroups: groups.sort((a, b) => b.correlatedEvents.length - a.correlatedEvents.length),
      correlatedEventIds: eventIds,
    };
  }, [mlcErrors, eventsByType, localWindowMs]);
      // 2) derive paginated groups (after correlatedGroups is computed)
      const paginatedGroups = useMemo(() => {
      return correlatedGroups.slice(page * pageSize, (page + 1) * pageSize);
      }, [correlatedGroups, page]);
      const totalPages = Math.ceil(correlatedGroups.length / pageSize);

  // Notify parent of correlated event IDs
  useMemo(() => {
    onCorrelatedEventIds?.(correlatedEventIds);
  }, [correlatedEventIds, onCorrelatedEventIds]);

  /**
   * Executes `toggleGroup`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const toggleGroup = (errorId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(errorId)) {
        next.delete(errorId);
      } else {
        next.add(errorId);
      }
      return next;
    });
  };

  /**
   * Executes `handleWindowChange`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const handleWindowChange = (value: number[]) => {
    const newWindowMs = value[0] * 1000;
    setLocalWindowMs(newWindowMs);
    onWindowChange?.(newWindowMs);
  };

  if (correlatedGroups.length === 0) {
    return null;
  }

  /**
   * Executes `formatTimeDiff`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const formatTimeDiff = (ms: number) => {
    const absMs = Math.abs(ms);
    const sign = ms >= 0 ? '+' : '-';
    if (absMs < 1000) return `${sign}${absMs}ms`;
    if (absMs < 60000) return `${sign}${(absMs / 1000).toFixed(1)}s`;
    return `${sign}${(absMs / 60000).toFixed(1)}m`;
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <div className="flex items-center gap-2 cursor-pointer hover:opacity-80">
              {isOpen ? (
                <ChevronDown className="h-5 w-5 text-amber-500" />
              ) : (
                <ChevronRight className="h-5 w-5 text-amber-500" />
              )}
              <Link2 className="h-5 w-5 text-amber-500" />
              <CardTitle className="text-base">Correlated Events</CardTitle>
              <Badge variant="outline" className="ml-auto">
                {correlatedGroups.length} MLC errors with related events
              </Badge>
            </div>
          </CollapsibleTrigger>
          <div className="flex items-center justify-between mt-2">
            <p className="text-sm text-muted-foreground">
              Events occurring within {localWindowMs / 1000}s of MLC errors
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1"
              onClick={(e) => {
                e.stopPropagation();
                setShowSettings(!showSettings);
              }}
            >
              <Settings2 className="h-4 w-4" />
              Correlation Settings
            </Button>
          </div>
          {showSettings && (
            <div className="mt-3 p-3 bg-muted/50 rounded-lg space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Time Window:</span>
                <span className="font-mono">{localWindowMs / 1000}s</span>
              </div>
              <Slider
                value={[localWindowMs / 1000]}
                onValueChange={handleWindowChange}
                min={0.11}
                max={60}
                step={0.1}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                Adjust the time window (0.1s - 60s) for correlating events with MLC errors
              </p>
            </div>
          )}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-2">
            {paginatedGroups.map((group) => {
              const errorKey = `${group.mlcError.timestamp.getTime()}-${group.mlcError.mlcMotor}`;
              const isExpanded = expandedGroups.has(errorKey);

              return (
                <Collapsible 
                  key={errorKey} 
                  open={isExpanded} 
                  onOpenChange={() => toggleGroup(errorKey)}
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="w-full justify-start gap-2 h-auto py-2 px-3 hover:bg-muted/50"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0" />
                      )}
                      <div className="flex flex-col items-start text-left flex-1 min-w-0">
                        <div className="flex items-center gap-2 w-full">
                          <span className="font-mono text-xs text-muted-foreground">
                            {format(group.mlcError.timestamp, 'yyyy-MM-dd HH:mm:ss')}
                          </span>
                          <Badge variant="destructive" className="text-xs">
                            Motor {group.mlcError.mlcMotor} Bank {group.mlcError.bank}
                          </Badge>
                        </div>
                        <span className="text-sm truncate w-full">
                          {group.mlcError.errorText || group.mlcError.errorCode}
                        </span>
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {group.correlatedEvents.length} related
                      </Badge>
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="ml-6 mt-1 space-y-1 border-l-2 border-muted pl-3">
                      {group.correlatedEvents.map((ce, idx) => (
                        <div 
                          key={`${ce.event.id}-${idx}`}
                          className="flex items-center gap-2 py-1.5 px-2 rounded bg-muted/30 text-sm"
                        >
                          <span className={cn('w-2 h-2 rounded-full shrink-0', EVENT_LOG_TYPE_COLORS[ce.logType])} />
                          <span className="text-xs text-muted-foreground font-mono shrink-0">
                            {EVENT_LOG_TYPE_LABELS[ce.logType].split(' ')[0]}
                          </span>
                          <span className="truncate flex-1 text-foreground">
                            {ce.event.description || ce.event.eventCode}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span className={cn(
                              'text-xs font-mono',
                              ce.timeDiffMs >= 0 ? 'text-green-500' : 'text-amber-500'
                            )}>
                              {formatTimeDiff(ce.timeDiffMs)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 py-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page + 1} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                >
                  Next
                </Button>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};

// Export the correlation IDs utility function for use in other components
/**
 * Retrieves data for `getCorrelatedEventIds`.
 *
 * @param args Function input.
 * @returns Retrieved value.
 */
export const getCorrelatedEventIds = (
  mlcErrors: MLCError[],
  eventsByType: EventsByType,
  windowMs: number
): Set<string> => {
  const eventIds = new Set<string>();
  const hardErrors = mlcErrors.filter(e => e.isHardError);
  
  Object.entries(eventsByType).forEach(([type, events]) => {
    if (type !== 'COL') {
      events.forEach(event => {
        const eventTime = event.timestamp.getTime();
        hardErrors.forEach(mlcError => {
          const errorTime = mlcError.timestamp.getTime();
          if (Math.abs(eventTime - errorTime) <= windowMs) {
            eventIds.add(event.id);
          }
        });
      });
    }
  });
  
  return eventIds;
};
