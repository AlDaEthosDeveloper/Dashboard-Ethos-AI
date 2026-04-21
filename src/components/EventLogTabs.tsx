import { useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { GenericEvent } from '@/data/genericEventData';
import { EventLogType, EVENT_LOG_TYPES } from '@/data/eventLogTypes';
import { MLCError } from '@/data/mlcErrorData';
import { 
  SubsystemType, 
  getConfiguredSubsystems,
  getSubsystemColor,
  getSubsystemLabel,
  groupEventsBySubsystem,
  resolveEventOperationalMode,
} from '@/data/componentSubsystems';
import { EventLogTable } from '@/components/EventLogTable';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, Link2, Clock, Settings2, Search, X, Layers, ArrowUpDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useAppConfig } from '@/contexts/AppConfigContext';

interface EventLogTabsProps {
  eventsByType: Record<EventLogType, GenericEvent[]>;
  mlcErrors?: MLCError[];
  onClearEvents: (logType: EventLogType) => void;
  correlatedEventIds?: Set<string>;
  onSelectTimeWindow?: (start: Date, end: Date) => void;
  initialSubsystem?: SubsystemType;
}

interface CorrelatedEventGroup {
  primaryEvent: GenericEvent;
  relatedEvents: Array<{
    event: GenericEvent;
    timeDiffMs: number;
  }>;
}

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const;

/**
 * Executes `EventLogTabs`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export const EventLogTabs = ({
  eventsByType,
  mlcErrors = [],
  onClearEvents,
  correlatedEventIds = new Set(),
  onSelectTimeWindow,
  initialSubsystem,
}: EventLogTabsProps) => {
  const { config } = useAppConfig();
  const [descriptionSearch, setDescriptionSearch] = useState('');
  const [correlationWindowMs, setCorrelationWindowMs] = useState(2000);
  const [showCorrelationSettings, setShowCorrelationSettings] = useState(false);
  const [expandedCorrelations, setExpandedCorrelations] = useState<Set<string>>(new Set());
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [correlationPageSize, setCorrelationPageSize] = useState(5);
  const [showDataLogs, setShowDataLogs] = useState(false);
  const [showServiceMode, setShowServiceMode] = useState(false);
  const [showClinicalMode, setShowClinicalMode] = useState(true);
  const configuredSubsystems = useMemo(() => getConfiguredSubsystems(config.subsystemConfig), [config.subsystemConfig]);

  const [correlationPage, setCorrelationPage] = useState<Record<string, number>>({});

  /**
   * Retrieves data for `getPage`.
   *
   * @param args Function input.
   * @returns Retrieved value.
   */
  const getPage = (subsystem: string) => correlationPage[subsystem] ?? 0;
  /**
   * Executes `setPage`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const setPage = (subsystem: string, page: number) =>
    setCorrelationPage(prev => ({ ...prev, [subsystem]: page }));

  // Reset pages when page size changes
  /**
   * Executes `handlePageSizeChange`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const handlePageSizeChange = (size: number) => {
    setCorrelationPageSize(size);
    setCorrelationPage({});
  };

  // Convert MLC errors to GenericEvent format for inclusion in Collimator tab
  const mlcAsGenericEvents: GenericEvent[] = useMemo(() => {
    return mlcErrors.map(err => ({
      id: `mlc-${err.timestamp.getTime()}-${err.mlcMotor}-${err.bank}`,
      timestamp: err.timestamp,
      machineSerial: err.machineSerial as any,
      logType: 'COL' as EventLogType,
      eventCode: err.errorCode,
      component: `MLC Motor ${err.mlcMotor} Bank ${err.bank}`,
      description: err.errorText || err.errorCode,
      severity: (err.isHardError ? 'Error' : 'Warning') as GenericEvent['severity'],
    }));
  }, [mlcErrors]);

  const modeFromEvent = (event: GenericEvent) => {
    const mode = resolveEventOperationalMode(event, config.subsystemConfig);
    return {
      hasServiceMode: mode === 'service',
      hasClinicalMode: mode === 'clinical',
      isDataLog: mode === 'data',
    };
  };

  // Collect all events and filter out already correlated ones, now including MLC errors
  const allNonColEventsRaw = useMemo(() => {
    const events: GenericEvent[] = [];
    EVENT_LOG_TYPES.forEach(type => {
      (eventsByType[type] || []).forEach(event => {
        if (!correlatedEventIds.has(event.id)) {
          events.push(event);
        }
      });
    });
    mlcAsGenericEvents.forEach(event => {
      if (!correlatedEventIds.has(event.id)) {
        events.push(event);
      }
    });
    return events.filter((event) => {
      const mode = modeFromEvent(event);
      if (mode.isDataLog) return showDataLogs;
      if (mode.hasServiceMode && showServiceMode) return true;
      if (mode.hasClinicalMode && showClinicalMode) return true;
      return false;
    });
  }, [eventsByType, correlatedEventIds, mlcAsGenericEvents, showClinicalMode, showDataLogs, showServiceMode]);

  const allNonColEvents = useMemo(() => {
    return allNonColEventsRaw.filter((event) => {
      const mode = modeFromEvent(event);
      if (mode.isDataLog) return showDataLogs;
      if (mode.hasServiceMode && showServiceMode) return true;
      if (mode.hasClinicalMode && showClinicalMode) return true;
      return false;
    });
  }, [allNonColEventsRaw, showClinicalMode, showDataLogs, showServiceMode]);

  const totalRawEvents = allNonColEventsRaw.length;
  const noModeSelected = !showDataLogs && !showServiceMode && !showClinicalMode;
  

  // Apply description search filter
  const filteredNonColEvents = useMemo(() => {
    if (!descriptionSearch.trim()) return allNonColEvents;
    const query = descriptionSearch.toLowerCase();
    return allNonColEvents.filter(e =>
      e.description?.toLowerCase().includes(query) ||
      e.component?.toLowerCase().includes(query) ||
      e.eventCode?.toLowerCase().includes(query)
    );
  }, [allNonColEvents, descriptionSearch]);

  // Group events by subsystem (using filtered events)
  const eventsBySubsystem = useMemo(() => {
    return groupEventsBySubsystem(filteredNonColEvents, config.subsystemConfig);
  }, [config.subsystemConfig, filteredNonColEvents]);

  // Find subsystems with events
  const allEventsBySubsystem = useMemo(() => {
    return groupEventsBySubsystem(allNonColEvents, config.subsystemConfig);
  }, [allNonColEvents, config.subsystemConfig]);

  const subsystemsWithEvents = useMemo(() => {
    return configuredSubsystems.filter(type => (allEventsBySubsystem[type] || []).length > 0);
  }, [allEventsBySubsystem, configuredSubsystems]);

  // Calculate correlations across subsystems
  const correlationsBySubsystem = useMemo(() => {
    const result: Record<string, CorrelatedEventGroup[]> = {};
    configuredSubsystems.forEach((subsystem) => {
      result[subsystem] = [];
    });

    const allEvents: Array<GenericEvent & { subsystem: string }> = [];
    configuredSubsystems.forEach(subsystem => {
      (eventsBySubsystem[subsystem] || []).forEach(e => {
        allEvents.push({ ...e, subsystem });
      });
    });

    if (allEvents.length < 2) return result;

    const sorted = [...allEvents].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );

    const usedEventIds = new Set<string>();

    sorted.forEach(seed => {
      if (usedEventIds.has(seed.id)) return;
      const seedTime = seed.timestamp.getTime();
      const groupEvents = sorted.filter(e => {
        if (usedEventIds.has(e.id)) return false;
        return Math.abs(e.timestamp.getTime() - seedTime) <= correlationWindowMs;
      });

      if (groupEvents.length < 2) return;

      const root = groupEvents.reduce((earliest, current) => {
        const timeDiff = current.timestamp.getTime() - earliest.timestamp.getTime();
        if (timeDiff < 0) return current;
        if (timeDiff === 0 && earliest.subsystem === 'Supervisor' && current.subsystem !== 'Supervisor') return current;
        return earliest;
      });

      const related = groupEvents
        .filter(e => e.id !== root.id)
        .map(e => ({
          event: e,
          timeDiffMs: e.timestamp.getTime() - root.timestamp.getTime(),
        }))
        .sort((a, b) => a.timeDiffMs - b.timeDiffMs);

      result[root.subsystem].push({ primaryEvent: root, relatedEvents: related });
      groupEvents.forEach(e => usedEventIds.add(e.id));
    });

    return result;
  }, [configuredSubsystems, eventsBySubsystem, correlationWindowMs]);

  // Global correlations for the "Main" tab
  const allCorrelationGroups = useMemo(() => {
    const groups: CorrelatedEventGroup[] = [];
    configuredSubsystems.forEach(subsystem => {
      groups.push(...correlationsBySubsystem[subsystem]);
    });
    return groups.sort((a, b) => {
      const diff = a.primaryEvent.timestamp.getTime() - b.primaryEvent.timestamp.getTime();
      return sortOrder === 'newest' ? -diff : diff;
    });
  }, [configuredSubsystems, correlationsBySubsystem, sortOrder]);

  // Sort per-subsystem correlations too
  const sortedCorrelationsBySubsystem = useMemo(() => {
    const result: Record<string, CorrelatedEventGroup[]> = {};
    configuredSubsystems.forEach(subsystem => {
      result[subsystem] = [...correlationsBySubsystem[subsystem]].sort((a, b) => {
        const diff = a.primaryEvent.timestamp.getTime() - b.primaryEvent.timestamp.getTime();
        return sortOrder === 'newest' ? -diff : diff;
      });
    });
    return result;
  }, [configuredSubsystems, correlationsBySubsystem, sortOrder]);

  const totalNonColEvents = allNonColEvents.length;
  const totalFilteredEvents = filteredNonColEvents.length;

  /**
   * Executes `toggleCorrelation`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const toggleCorrelation = (eventId: string) => {
    setExpandedCorrelations(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

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

  /**
   * Executes `selectCorrelationWindow`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const selectCorrelationWindow = (group: CorrelatedEventGroup) => {
    if (!onSelectTimeWindow) return;
    const times = [group.primaryEvent.timestamp, ...group.relatedEvents.map(r => r.event.timestamp)];
    const start = new Date(Math.min(...times.map(t => t.getTime())));
    const end = new Date(Math.max(...times.map(t => t.getTime())));
    onSelectTimeWindow(start, end);
  };

  // Shared correlation group renderer
  /**
   * Executes `renderCorrelationGroup`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const renderCorrelationGroup = (group: CorrelatedEventGroup) => {
    const isExpanded = expandedCorrelations.has(group.primaryEvent.id);

    return (
      <Collapsible
        key={group.primaryEvent.id}
        open={isExpanded}
        onOpenChange={() => toggleCorrelation(group.primaryEvent.id)}
      >
        <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full grid grid-cols-[auto_auto_1fr_auto] gap-2 items-start text-xs text-left"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}

                  <span className="font-mono text-muted-foreground whitespace-nowrap">
                    {format(group.primaryEvent.timestamp, 'yyyy-MM-dd HH:mm:ss')}
                  </span>

                  <span className="truncate">
                    {group.primaryEvent.component} – {group.primaryEvent.description}
                  </span>

                  <div className="flex items-center gap-2 justify-self-end">
                    <span className="text-muted-foreground">
                      {group.primaryEvent.eventCode}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      +{group.relatedEvents.length}
                    </Badge>
                  </div>
                </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-5 mt-0.5 space-y-0.5 border-l-2 border-muted pl-2">
            {/* Full description of primary event */}
            <div className="py-1 px-1.5 rounded bg-primary/10 text-xs space-y-0.5">
              <div className="font-medium text-primary">Primary event</div>
              <div className="max-w-[100rem] break-words whitespace-normal">
                {group.primaryEvent.component} – {group.primaryEvent.description}
              </div>
              {(group.primaryEvent as any).rawData?.preciseTime && (
                <div className="font-mono text-muted-foreground">
                  Precise: {(group.primaryEvent as any).rawData.preciseTime}
                </div>
              )}
            </div>
            {group.relatedEvents.map((re, idx) => (
              <div
                key={`${re.event.id}-${idx}`}
                className="flex min-w-0 items-start gap-2 py-1 px-1.5 rounded bg-muted/30 text-xs overflow-hidden"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="max-w-[100rem] break-words whitespace-normal">
                    {re.event.component} – {re.event.description}
                  </div>
                  {(re.event as any).rawData?.preciseTime && (
                    <div className="font-mono text-muted-foreground">
                      Precise: {(re.event as any).rawData.preciseTime}
                    </div>
                  )}
                </div>
                <span className="shrink-0 text-muted-foreground">
                  {re.event.eventCode}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <span className={cn(
                    'font-mono',
                    re.timeDiffMs >= 0 ? 'text-green-500' : 'text-amber-500'
                  )}>
                    {formatTimeDiff(re.timeDiffMs)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  // Shared pagination renderer
  /**
   * Executes `renderPagination`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const renderPagination = (subsystemKey: string, totalGroups: number) => {
    const totalPages = Math.ceil(totalGroups / correlationPageSize);
    if (totalPages <= 1) return null;

    return (
      <div className="flex items-center justify-center gap-2 py-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage(subsystemKey, Math.max(0, getPage(subsystemKey) - 1))}
          disabled={getPage(subsystemKey) === 0}
        >
          Previous
        </Button>
        <span className="text-xs text-muted-foreground">
          Page {getPage(subsystemKey) + 1} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage(subsystemKey, Math.min(totalPages - 1, getPage(subsystemKey) + 1))}
          disabled={getPage(subsystemKey) >= totalPages - 1}
        >
          Next
        </Button>
      </div>
    );
  };

  return (
    <div className="bg-card rounded-xl border border-border p-6 w-full min-w-0 max-w-full overflow-x-hidden">
      <div className="mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm text-muted-foreground">
              All events grouped by subsystem ({totalFilteredEvents}{descriptionSearch ? ` of ${totalNonColEvents}` : ''} total events)
            </p>
            {noModeSelected && totalRawEvents > 0 && (
              <p className="text-xs text-amber-500 mt-1">All mode filters are off. Enable at least one filter to show events.</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden lg:flex items-center gap-3 mr-2">
              <div className="flex items-center gap-1.5">
                <Checkbox id="filter-data-logs" checked={showDataLogs} onCheckedChange={(checked) => setShowDataLogs(Boolean(checked))} />
                <Label htmlFor="filter-data-logs" className="text-xs cursor-pointer">Data logs</Label>
              </div>
              <div className="flex items-center gap-1.5">
                <Checkbox id="filter-service-mode" checked={showServiceMode} onCheckedChange={(checked) => setShowServiceMode(Boolean(checked))} />
                <Label htmlFor="filter-service-mode" className="text-xs cursor-pointer">Service mode</Label>
              </div>
              <div className="flex items-center gap-1.5">
                <Checkbox id="filter-clinical-mode" checked={showClinicalMode} onCheckedChange={(checked) => setShowClinicalMode(Boolean(checked))} />
                <Label htmlFor="filter-clinical-mode" className="text-xs cursor-pointer">Clinical mode</Label>
              </div>
            </div>
            {/* Sort order toggle */}
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              onClick={() => setSortOrder(prev => prev === 'newest' ? 'oldest' : 'newest')}
            >
              <ArrowUpDown className="h-4 w-4" />
              {sortOrder === 'newest' ? 'Newest first' : 'Oldest first'}
            </Button>
            {/* Page size selector */}
            <div className="flex items-center gap-1 border rounded-md">
              {PAGE_SIZE_OPTIONS.map(size => (
                <Button
                  key={size}
                  variant={correlationPageSize === size ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => handlePageSizeChange(size)}
                >
                  {size}
                </Button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1"
              onClick={() => setShowCorrelationSettings(!showCorrelationSettings)}
            >
              <Settings2 className="h-4 w-4" />
              Correlation Settings
            </Button>
          </div>
        </div>
        
        {showCorrelationSettings && (
          <div className="mt-3 p-3 bg-muted/50 rounded-lg space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Event Correlation Window:</span>
              <span className="font-mono">{correlationWindowMs / 1000}s</span>
            </div>
            <Slider
              value={[correlationWindowMs / 1000]}
              onValueChange={(value) => setCorrelationWindowMs(value[0] * 1000)}
              min={0.5}
              max={120}
              step={0.5}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Events occurring within this time window will be grouped together
            </p>
          </div>
        )}

        {/* Description search */}
        <div className="mt-3 flex flex-wrap items-center gap-3 lg:hidden">
          <div className="flex items-center gap-1.5">
            <Checkbox id="filter-data-logs-mobile" checked={showDataLogs} onCheckedChange={(checked) => setShowDataLogs(Boolean(checked))} />
            <Label htmlFor="filter-data-logs-mobile" className="text-xs cursor-pointer">Data logs</Label>
          </div>
          <div className="flex items-center gap-1.5">
            <Checkbox id="filter-service-mode-mobile" checked={showServiceMode} onCheckedChange={(checked) => setShowServiceMode(Boolean(checked))} />
            <Label htmlFor="filter-service-mode-mobile" className="text-xs cursor-pointer">Service mode</Label>
          </div>
          <div className="flex items-center gap-1.5">
            <Checkbox id="filter-clinical-mode-mobile" checked={showClinicalMode} onCheckedChange={(checked) => setShowClinicalMode(Boolean(checked))} />
            <Label htmlFor="filter-clinical-mode-mobile" className="text-xs cursor-pointer">Clinical mode</Label>
          </div>
        </div>

        <div className="mt-3 relative max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search description, component, code..."
            value={descriptionSearch}
            onChange={(e) => setDescriptionSearch(e.target.value)}
            className="pl-9 pr-9"
          />
          {descriptionSearch && (
            <button
              onClick={() => setDescriptionSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <Tabs defaultValue={initialSubsystem || 'Main'} className="space-y-4 min-w-0 w-full">
        <TabsList className="w-full max-w-full flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="Main" className="gap-2">
            <Layers className="h-3 w-3" />
            Main
            {allCorrelationGroups.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {allCorrelationGroups.length}
              </Badge>
            )}
          </TabsTrigger>
          {subsystemsWithEvents.map((subsystem, index) => (
            <TabsTrigger key={subsystem} value={subsystem} className="gap-2">
              <span className={cn('w-2 h-2 rounded-full', getSubsystemColor(subsystem, index))} />
              {getSubsystemLabel(subsystem).split(' (')[0]}
              <Badge variant="secondary" className="text-xs">
                {(eventsBySubsystem[subsystem] || []).length}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Main tab */}
        <TabsContent value="Main" className="space-y-4">
          {allCorrelationGroups.length > 0 ? (
            <Card className="border-primary/30 bg-primary/5 overflow-hidden w-full min-w-0">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Layers className="h-4 w-4 text-primary shrink-0" />
                  <CardTitle className="text-sm truncate">All Correlated Event Groups</CardTitle>
                  <Badge variant="outline" className="ml-auto text-xs">
                    {allCorrelationGroups.length} groups
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Events correlated within {correlationWindowMs / 1000}s — first event in each group is the primary/root event
                </p>
              </CardHeader>
              <CardContent className="space-y-1 min-w-0">
                {allCorrelationGroups
                  .slice(getPage('Main') * correlationPageSize, (getPage('Main') + 1) * correlationPageSize)
                  .map(renderCorrelationGroup)}
                {renderPagination('Main', allCorrelationGroups.length)}
              </CardContent>
            </Card>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              {totalRawEvents === 0
                ? 'No events found. Upload more event logs to see cross-subsystem correlations.'
                : 'No correlated event groups found for the active mode filter(s).'}
            </div>
          )}
        </TabsContent>

        {subsystemsWithEvents.map(subsystem => {
          const correlations = sortedCorrelationsBySubsystem[subsystem];
          const hasCorrelations = correlations.length > 0;

          return (
            <TabsContent key={subsystem} value={subsystem} className="space-y-4">
              {hasCorrelations && (
                <Card className="border-blue-500/30 bg-blue-500/5 overflow-hidden w-full min-w-0">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <Link2 className="h-4 w-4 text-blue-500" />
                      <CardTitle className="text-sm">Correlated {getSubsystemLabel(subsystem)} Events</CardTitle>
                      <Badge variant="outline" className="ml-auto text-xs">
                        {correlations.length} groups
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Events occurring within {correlationWindowMs / 1000}s of each other
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {correlations
                      .slice(getPage(subsystem) * correlationPageSize, (getPage(subsystem) + 1) * correlationPageSize)
                      .map(renderCorrelationGroup)}
                    {renderPagination(subsystem, correlations.length)}
                  </CardContent>
                </Card>
              )}

              <EventLogTable
                events={eventsBySubsystem[subsystem] || []}
                logType="Other"
                onClear={() => {
                  EVENT_LOG_TYPES.forEach(type => {
                    if (eventsByType[type].some(e => 
                      (eventsBySubsystem[subsystem] || []).some(se => se.id === e.id)
                    )) {
                      onClearEvents(type);
                    }
                  });
                }}
              />
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
};
