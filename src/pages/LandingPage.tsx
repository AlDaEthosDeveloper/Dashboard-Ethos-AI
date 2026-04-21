import { useMemo } from 'react';
import { endOfDay, format, isWithinInterval, startOfDay } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useDashboard } from '@/contexts/DashboardContext';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { MLCHeatmap } from '@/components/MLCHeatmap';
import { DateRangePicker } from '@/components/DateRangePicker';
import { EVENT_LOG_TYPES } from '@/data/eventLogTypes';
import { GenericEvent } from '@/data/genericEventData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { buildMotorTrendMap } from '@/lib/mlcInsights';
import { MachineId } from '@/data/mlcErrorData';
import {
  aggregateSeriesDaily,
  buildCountYAxis,
  buildYAxis,
  extractMagnetronArcsSeries,
  extractStatisticsSeries,
  filterOutStatisticsEvents,
  formatYAxisTick,
} from '@/lib/statisticsCharts';
import { getConfiguredSubsystems, getSubsystemColor, groupEventsBySubsystem } from '@/data/componentSubsystems';
import { EventsByType } from '@/hooks/useEventLogData';
import { ErrorTimeline } from '@/components/ErrorTimeline';

const LandingPage = () => {
  const navigate = useNavigate();
  const { machineData, eventData, dateRange, setDateRange, setSelectedMachine, machineLastRunStatusByMachine } = useDashboard();
  const { config, getMachineLabel } = useAppConfig();

  const machineSections = useMemo(() => {
    return config.machineIds.map((machineId) => {
      const errorsInRange = (machineData[machineId]?.errors || []).filter((error) =>
        isWithinInterval(error.timestamp, {
          start: startOfDay(dateRange.from),
          end: endOfDay(dateRange.to),
        }),
      );

      const eventsInRangeByType = EVENT_LOG_TYPES.reduce<Record<string, GenericEvent[]>>((acc, type) => {
        acc[type] = (eventData[machineId]?.[type] || []).filter((event) =>
          isWithinInterval(event.timestamp, {
            start: startOfDay(dateRange.from),
            end: endOfDay(dateRange.to),
          }),
        );
        return acc;
      }, {});

      const nonStatisticsEventsInRangeByType = filterOutStatisticsEvents(eventsInRangeByType);
      const allEvents = Object.values(nonStatisticsEventsInRangeByType).flat();
      const grouped = groupEventsBySubsystem(allEvents, config.subsystemConfig);
      const configuredSubsystems = getConfiguredSubsystems(config.subsystemConfig);
      const subsystemsWithEvents = configuredSubsystems.filter((subsystem) => (grouped[subsystem] || []).length > 0);
      const typedEventsByType = eventsInRangeByType as EventsByType;
      const chartSettingMap = new Map(config.chartSettings.map((setting) => [setting.eventName, setting] as const));
      const chartSeries = extractStatisticsSeries(typedEventsByType)
        .map((series) => {
          const setting = chartSettingMap.get(series.key);
          return {
            ...series,
            label: setting?.displayName || series.label,
            visible: setting?.visible !== false,
          };
        })
        .filter((series) => series.visible)
        .slice(0, 6);
      const magnetronArcs = extractMagnetronArcsSeries(typedEventsByType);

      return {
        machineId,
        errorsInRange,
        eventsBySubsystem: grouped,
        configuredSubsystems: subsystemsWithEvents,
        nonStatisticsEventCount: allEvents.length,
        chartSeries,
        magnetronArcs,
      };
    });
  }, [config.chartSettings, config.machineIds, dateRange.from, dateRange.to, eventData, machineData]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Home</h2>
        </div>
        <div className="ml-auto shrink-0">
          <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} />
        </div>
      </div>

      <div className="space-y-4">
        {machineSections.map((section) => {
          const replacements = machineData[section.machineId]?.replacements || [];
          const trendMap = buildMotorTrendMap(section.errorsInRange, replacements, config.mlcTrendSettings);

          return (
            <Card key={section.machineId} className="border-border/80">
              <CardHeader className="pb-1 pt-4">
                <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
                  <span>{getMachineLabel(section.machineId)}</span>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <div
                      className={`rounded-lg border border-border bg-card px-3 py-2 text-xs ${(() => {
                        const timestamp = machineLastRunStatusByMachine[section.machineId]?.timestamp;
                        if (!timestamp) return 'text-muted-foreground';
                        const lastRun = new Date(timestamp).getTime();
                        if (Number.isNaN(lastRun)) return 'text-muted-foreground';
                        const diffMinutes = (Date.now() - lastRun) / (1000 * 60);
                        return diffMinutes > 20 ? 'text-red-500' : 'text-muted-foreground';
                      })()}`}
                    >
                      <span className="font-medium text-foreground">Machine last copy run:</span>{' '}
                      {machineLastRunStatusByMachine[section.machineId]?.timestamp || 'N/A'}
                    </div>
                    {config.pageVisibility.overview !== false && (
                      <Badge
                        className="cursor-pointer"
                        variant="secondary"
                        onClick={() => {
                          setSelectedMachine(section.machineId as MachineId);
                          navigate('/all-faults');
                        }}
                      >
                        Open overview
                      </Badge>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="rounded-lg border p-3">
                  <div className="text-sm font-medium mb-1.5">All Events by subsystem</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedMachine(section.machineId as MachineId);
                        navigate('/other');
                      }}
                      className="rounded-md border px-2 py-2 text-sm font-medium text-left hover:bg-muted"
                    >
                      <div className="truncate">All Events</div>
                      <div className="text-base font-bold">{section.nonStatisticsEventCount}</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedMachine(section.machineId as MachineId);
                        navigate('/mlc');
                      }}
                      className="rounded-md border px-2 py-2 text-sm font-medium text-left hover:bg-muted"
                    >
                      <div className="truncate">MLC Errors</div>
                      <div className="text-base font-bold">{section.errorsInRange.length}</div>
                    </button>
                    {section.configuredSubsystems.map((subsystem, index) => (
                      <button
                        key={`${section.machineId}-${subsystem}`}
                        type="button"
                        onClick={() => {
                          setSelectedMachine(section.machineId as MachineId);
                          navigate(`/other?subsystem=${subsystem}`);
                        }}
                        className="rounded-md border px-2 py-2 text-sm font-medium text-left hover:bg-muted"
                      >
                        <div className="truncate flex items-center gap-1.5">
                          <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', getSubsystemColor(subsystem, index))} />
                          {subsystem}
                        </div>
                        <div className="text-base font-bold">{(section.eventsBySubsystem[subsystem] || []).length}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded border p-1 cursor-pointer hover:bg-muted/40"
                      onClick={() => {
                        setSelectedMachine(section.machineId as MachineId);
                        navigate('/mlc?focus=mlc-heatmap');
                      }}
                      >
                  <MLCHeatmap
                    title="MLC heatmap"
                    errors={section.errorsInRange}
                    replacements={replacements}
                    trendMap={trendMap}
                    selectedMotors={[]}
                    onMotorSelect={(selection) => {
                      setSelectedMachine(section.machineId as MachineId);
                      navigate('/mlc', { state: selection });
                    }}
                    showMotorErrorCounts={false}
                    onShowMotorErrorCountsChange={() => undefined}
                    showCountToggle={false}
                    showTrendIcons={false}
                    compactLegend
                    compactCells
                    denseLayout
                    splitBanks
                  />
                </div>


                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                  {section.chartSeries.map((series) => {
                    const points = aggregateSeriesDaily(series.points);
                    const yAxisConfig = buildYAxis(points, {
                      showMin: true,
                      showMax: true,
                      showAvg: true,
                      dailyAggregation: true,
                    });
                    return (
                      <div
                        key={`${section.machineId}-${series.key}`}
                        className="rounded border p-1 cursor-pointer hover:bg-muted/40"
                        onClick={() => {
                          setSelectedMachine(section.machineId as MachineId);
                          navigate(`/charts?focus=${encodeURIComponent(series.key)}`);
                        }}
                      >
                        <div className="text-[11px] font-medium mb-1 truncate">{series.label}</div>
                        <ResponsiveContainer width="100%" height={122}>
                          <AreaChart data={points}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis
                              type="number"
                              fontSize={10}
                              dataKey="timestampMs"
                              scale="time"
                              domain={["dataMin", "dataMax"]}
                              tickFormatter={(v) => format(new Date(v), 'MMM dd, yyyy')}
                            />

                            <YAxis
                              fontSize={10}
                              width={54}
                              domain={yAxisConfig.domain}
                              ticks={yAxisConfig.ticks}
                              interval={0}
                              tickFormatter={(value) => formatYAxisTick(value, yAxisConfig)}
                            />
                            <Tooltip
                              formatter={(value: number) => [value.toFixed(1), series.label]}
                              labelFormatter={(_, payload) => {
                                const point = payload?.[0]?.payload as { timestamp?: Date } | undefined;
                                return point?.timestamp ? format(point.timestamp, 'PP') : '';
                              }}
                              contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }}
                              labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                              itemStyle={{ color: 'hsl(var(--foreground))' }}
                            />
                            <Area type="monotone" dataKey="minValue" name="Min" stroke="#34d399" fill="#34d399" fillOpacity={0.07} />
                            <Area type="monotone" dataKey="maxValue" name="Max" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.07} />
                            <Area type="monotone" dataKey="avgValue" name="Average" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} />
                            <Line type="monotone" dataKey="avgValue" stroke="#f59e0b" dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })}

                  {section.magnetronArcs ? (
                    (() => {
                      const maxArcs = section.magnetronArcs.points.reduce((max, point) => Math.max(max, point.arcs), 0);
                      const yAxis = buildCountYAxis(maxArcs);

                      return (
                        <div
                          className="rounded border p-1 cursor-pointer hover:bg-muted/40"
                          onClick={() => {
                            setSelectedMachine(section.machineId as MachineId);
                            navigate('/charts?focus=magnetron-arcs');
                          }}
                        >
                          <div className="text-[11px] font-medium mb-1">Magnetron Arcs</div>
                          <ResponsiveContainer width="100%" height={122}>
                            <AreaChart data={section.magnetronArcs.points}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis
                                type="number"
                                dataKey="dateMs"
                                scale="time"
                                domain={['dataMin', 'dataMax']}
                                tickFormatter={(value) => format(new Date(value), 'MMM dd, yyyy')}
                                fontSize={10}
                              />
                              <YAxis
                                fontSize={10}
                                width={54}
                                allowDecimals={false}
                                domain={yAxis.domain}
                                ticks={yAxis.ticks}
                                interval={0}
                              />
                              <Tooltip
                                formatter={(value: number) => [value.toFixed(0), 'Arcs']}
                                labelFormatter={(value) => format(new Date(value), 'PP')}
                                contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }}
                                labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                                itemStyle={{ color: 'hsl(var(--foreground))' }}
                              />
                              <Area type="monotone" dataKey="arcs" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} />
                              <Line type="monotone" dataKey="arcs" stroke="#ef4444" dot={false} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      );
                    })()
                  ) : null}
                

                  {section.errorsInRange.length > 0 && (
                    <div className="cursor-pointer hover:bg-muted/40"
                      onClick={() => {
                        setSelectedMachine(section.machineId as MachineId);
                        navigate('/mlc?focus=error-timeline');
                      }}
                      >
                      <ErrorTimeline
                        errors={section.errorsInRange}
                        dateRange={dateRange}
                        selectedMotors={[]}
                        compact
                        onDaySelect={(day) => {
                          setDateRange({ from: startOfDay(day), to: endOfDay(day) });
                          navigate('/mlc');
                        }}
                      />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default LandingPage;
