import { useEffect, useMemo, useState } from 'react';
import { format, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar, LineChart, Line } from 'recharts';
import { useDashboard } from '@/contexts/DashboardContext';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { DateRangeStatusBar } from '@/components/DateRangeStatusBar';
import { EVENT_LOG_TYPES } from '@/data/eventLogTypes';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { buildYAxis, extractMagnetronArcsSeries, extractStatisticsSeries, formatYAxisTick } from '@/lib/statisticsCharts';
import { EventsByType } from '@/hooks/useEventLogData';
import { getConfiguredSubsystems, groupEventsBySubsystem } from '@/data/componentSubsystems';
import { Button } from '@/components/ui/button';

const ComparisonPage = () => {
  const { machineData, eventData, dateRange } = useDashboard();
  const { config, getMachineLabel } = useAppConfig();
  const [selectedMachines, setSelectedMachines] = useState<string[]>([]);
  const [mode, setMode] = useState<'' | 'mlc' | 'statistic' | 'magnetron' | 'subsystem'>('');
  const [selectedStatistic, setSelectedStatistic] = useState<string>('');
  const configuredSubsystems = useMemo(() => getConfiguredSubsystems(config.subsystemConfig), [config.subsystemConfig]);
  const [selectedSubsystem, setSelectedSubsystem] = useState<string>('Couch');
  const [lookupQuery, setLookupQuery] = useState('');
  const [statVisibility, setStatVisibility] = useState({ min: false, max: false, avg: true });

  const chartSettingMap = useMemo(() => new Map(config.chartSettings.map((setting) => [setting.eventName, setting] as const)), [config.chartSettings]);

  const filteredByMachine = useMemo(() => {
    return Object.fromEntries(
      config.machineIds.map((machineId) => {
        const errors = (machineData[machineId]?.errors || []).filter((error) =>
          isWithinInterval(error.timestamp, {
            start: startOfDay(dateRange.from),
            end: endOfDay(dateRange.to),
          }),
        );

        const eventsByType = EVENT_LOG_TYPES.reduce((acc, type) => {
          acc[type] = (eventData[machineId]?.[type] || []).filter((event) =>
            isWithinInterval(event.timestamp, {
              start: startOfDay(dateRange.from),
              end: endOfDay(dateRange.to),
            }),
          );
          return acc;
        }, {} as EventsByType);

        return [machineId, { errors, eventsByType }];
      }),
    );
  }, [config.machineIds, dateRange.from, dateRange.to, eventData, machineData]);

  const statisticOptions = useMemo(() => {
    const set = new Set<string>();
    selectedMachines.forEach((machineId) => {
      extractStatisticsSeries(filteredByMachine[machineId]?.eventsByType || ({} as EventsByType))
        .forEach((series) => {
          const setting = chartSettingMap.get(series.key);
          if (setting?.visible !== false) {
            set.add(series.key);
          }
        });
    });
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [chartSettingMap, filteredByMachine, selectedMachines]);

  const statisticData = useMemo(() => {
    if (!selectedStatistic || !statVisibility.min && !statVisibility.max && !statVisibility.avg) {
      return [] as Array<{ timestampMs: number; timestamp: Date; [key: string]: number | Date }>;
    }

    const map = new Map<number, { timestampMs: number; timestamp: Date; [key: string]: number | Date }>();

    selectedMachines.forEach((machineId) => {
      const targetSeries = extractStatisticsSeries(filteredByMachine[machineId]?.eventsByType || ({} as EventsByType)).find(
        (series) => series.key === selectedStatistic,
      );

      (targetSeries?.points || []).forEach((point) => {
        const key = point.timestampMs;
        const setting = chartSettingMap.get(selectedStatistic);
        if (setting?.visible === false) return;
        const existing = map.get(key) || { timestampMs: key, timestamp: point.timestamp };
        if (statVisibility.min && point.minValue != null) existing[`${machineId}__min`] = point.minValue;
        if (statVisibility.max && point.maxValue != null) existing[`${machineId}__max`] = point.maxValue;
        if (statVisibility.avg && point.avgValue != null) existing[`${machineId}__avg`] = point.avgValue;
        map.set(key, existing);
      });
    });

    return Array.from(map.values()).sort((a, b) => a.timestampMs - b.timestampMs);
  }, [chartSettingMap, filteredByMachine, selectedMachines, selectedStatistic, statVisibility.avg, statVisibility.max, statVisibility.min]);

  const statisticSeries = useMemo(() => {
    const rows: Array<{ dataKey: string; name: string; color: string; dashed?: string }> = [];
    const palette = ['#f97316', '#14b8a6', '#6366f1', '#ef4444'];
    const strokeByMetric = {
      min: '8 4',
      max: undefined,
      avg: '2 4',
    } as const;

    selectedMachines.forEach((machineId, index) => {
      const baseColor = palette[index % palette.length];
      if (statVisibility.min) {
        rows.push({ dataKey: `${machineId}__min`, name: `${getMachineLabel(machineId)} Min`, color: baseColor, dashed: strokeByMetric.min });
      }
      if (statVisibility.max) {
        rows.push({ dataKey: `${machineId}__max`, name: `${getMachineLabel(machineId)} Max`, color: baseColor, dashed: strokeByMetric.max });
      }
      if (statVisibility.avg) {
        rows.push({ dataKey: `${machineId}__avg`, name: `${getMachineLabel(machineId)} Avg`, color: baseColor, dashed: strokeByMetric.avg });
      }
    });
    return rows;
  }, [getMachineLabel, selectedMachines, statVisibility.avg, statVisibility.max, statVisibility.min]);

  const statisticYAxis = useMemo(() => {
    const axisPoints = statisticData.flatMap((point) =>
      statisticSeries
        .map((series) => point[series.dataKey])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
        .map((value) => ({
          timestamp: point.timestamp as Date,
          timestampMs: point.timestampMs as number,
          label: '',
          avgValue: value,
        })),
    );

    return buildYAxis(axisPoints, { showMin: false, showMax: false, showAvg: true, dailyAggregation: false });
  }, [statisticData, statisticSeries]);

  const subsystemData = useMemo(() => {
    return selectedMachines.map((machineId) => {
      const grouped = groupEventsBySubsystem(Object.values(filteredByMachine[machineId]?.eventsByType || {}).flat(), config.subsystemConfig);
      return {
        machineId,
        count: (grouped[selectedSubsystem] || []).length,
      };
    });
  }, [config.subsystemConfig, filteredByMachine, selectedMachines, selectedSubsystem]);
  const subsystemOptionsWithEvents = useMemo(() => {
    const sourceMachines = selectedMachines.length > 0 ? selectedMachines : config.machineIds;
    return configuredSubsystems.filter((subsystem) =>
      sourceMachines.some((machineId) => {
        const grouped = groupEventsBySubsystem(Object.values(filteredByMachine[machineId]?.eventsByType || {}).flat(), config.subsystemConfig);
        return (grouped[subsystem] || []).length > 0;
      }),
    );
  }, [config.machineIds, config.subsystemConfig, configuredSubsystems, filteredByMachine, selectedMachines]);
  useEffect(() => {
    if (subsystemOptionsWithEvents.length === 0) return;
    if (!subsystemOptionsWithEvents.includes(selectedSubsystem)) {
      setSelectedSubsystem(subsystemOptionsWithEvents[0]);
    }
  }, [selectedSubsystem, subsystemOptionsWithEvents]);

  const magnetronData = useMemo(() => {
    const map = new Map<number, { dateMs: number; [key: string]: number }>();

    selectedMachines.forEach((machineId) => {
      const series = extractMagnetronArcsSeries(filteredByMachine[machineId]?.eventsByType || ({} as EventsByType));
      (series?.points || []).forEach((point) => {
        const existing = map.get(point.dateMs) || { dateMs: point.dateMs };
        existing[machineId] = point.arcs;
        map.set(point.dateMs, existing);
      });
    });

    return Array.from(map.values()).sort((a, b) => a.dateMs - b.dateMs);
  }, [filteredByMachine, selectedMachines]);

  const mlcSummary = useMemo(() => {
    const rows = selectedMachines.map((machineId) => {
      const errors = filteredByMachine[machineId]?.errors || [];
      const bankA = errors.filter((error) => error.bank === 'A');
      const bankB = errors.filter((error) => error.bank === 'B');
      const hardErrors = errors.filter((error) => error.isHardError).length;

      const byMotor = new Map<string, number>();
      errors.forEach((error) => {
        const key = `${error.bank}-${error.mlcMotor}`;
        byMotor.set(key, (byMotor.get(key) || 0) + 1);
      });

      const topMotors = Array.from(byMotor.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([key, count]) => {
          const [bank, motor] = key.split('-');
          return `${bank}${motor}: ${count}`;
        });

      return {
        machineId,
        totalErrors: errors.length,
        bankAErrors: bankA.length,
        bankBErrors: bankB.length,
        hardErrors,
        topMotors,
      };
    });

    return {
      rows,
      chartData: rows.map((row) => ({
        machine: getMachineLabel(row.machineId),
        'Bank A': row.bankAErrors,
        'Bank B': row.bankBErrors,
        Hard: row.hardErrors,
      })),
    };
  }, [filteredByMachine, getMachineLabel, selectedMachines]);

  const toggleMachine = (machineId: string, checked: boolean) => {
    setSelectedMachines((prev) => {
      if (checked) {
        return [...new Set([...prev, machineId])];
      }
      return prev.filter((id) => id !== machineId);
    });
  };

  const eventLookup = useMemo(() => {
    const query = lookupQuery.trim().toLowerCase();
    if (!query) return { byMachine: [], timeline: [] as Array<{ dayMs: number; [key: string]: number }> };

    const byMachine = selectedMachines.map((machineId) => {
      const errorMatches = (filteredByMachine[machineId]?.errors || []).filter((error) => {
        const searchable = `${error.errorCode} ${error.errorText || ''} Motor ${error.mlcMotor} ${error.bank}`.toLowerCase();
        return searchable.includes(query);
      });

      const eventMatches = Object.values(filteredByMachine[machineId]?.eventsByType || {})
        .flat()
        .filter((event) => {
          const searchable = `${event.component || ''} ${event.eventCode || ''} ${event.description || ''}`.toLowerCase();
          return searchable.includes(query);
        });

      return {
        machineId,
        errorMatches,
        eventMatches,
        total: errorMatches.length + eventMatches.length,
      };
    });

    const timelineMap = new Map<number, { dayMs: number; [key: string]: number }>();
    byMachine.forEach((machine) => {
      [...machine.errorMatches.map((item) => item.timestamp), ...machine.eventMatches.map((item) => item.timestamp)].forEach((timestamp) => {
        const day = startOfDay(timestamp).getTime();
        const existing = timelineMap.get(day) || { dayMs: day };
        existing[machine.machineId] = (existing[machine.machineId] || 0) + 1;
        timelineMap.set(day, existing);
      });
    });

    return {
      byMachine,
      timeline: Array.from(timelineMap.values()).sort((a, b) => a.dayMs - b.dayMs),
    };
  }, [filteredByMachine, lookupQuery, selectedMachines]);

  const showComparison = mode !== '' && selectedMachines.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Machine Comparison</h2>
          <p className="text-muted-foreground">Compare machine metrics side-by-side. </p>
        </div>
        <div className="flex items-center gap-2 ml-auto shrink-0">
          <DateRangeStatusBar />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Comparison controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Machines to compare</Label>
              <div className="space-y-1">
                {config.machineIds.map((machineId) => (
                  <label key={machineId} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedMachines.includes(machineId)}
                      onCheckedChange={(checked) => toggleMachine(machineId, Boolean(checked))}
                    />
                    <span>{getMachineLabel(machineId)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Comparison type</Label>
              <Select value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select comparison" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mlc">MLC error profile (top motors + bank split)</SelectItem>
                  <SelectItem value="statistic">Machine statistic (e.g. Water pressure)</SelectItem>
                  <SelectItem value="magnetron">Magnetron arcs (all selected machines)</SelectItem>
                  <SelectItem value="subsystem">Subsystem event count (e.g. Couch)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode === 'statistic' ? (
              <div className="space-y-2 lg:col-span-2">
                <Label>Statistic + values</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Select value={selectedStatistic} onValueChange={setSelectedStatistic}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select statistic" />
                    </SelectTrigger>
                    <SelectContent>
                      {statisticOptions.map((option) => (
                        <SelectItem key={option} value={option}>{chartSettingMap.get(option)?.displayName || option}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button size="sm" variant={statVisibility.min ? 'default' : 'outline'} onClick={() => setStatVisibility((prev) => ({ ...prev, min: !prev.min }))}>Min</Button>
                    <Button size="sm" variant={statVisibility.max ? 'default' : 'outline'} onClick={() => setStatVisibility((prev) => ({ ...prev, max: !prev.max }))}>Max</Button>
                    <Button size="sm" variant={statVisibility.avg ? 'default' : 'outline'} onClick={() => setStatVisibility((prev) => ({ ...prev, avg: !prev.avg }))}>Avg</Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground pt-1">
                  <span className="font-medium text-foreground">Line style key:</span>
                  <span>— solid = Max</span>
                  <span>- - dashed = Min</span>
                  <span>· · dotted = Avg</span>
                </div>
              </div>
            ) : null}

            {mode === 'subsystem' ? (
              <div className="space-y-2">
                <Label>Subsystem</Label>
                  <Select value={selectedSubsystem} onValueChange={setSelectedSubsystem}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {subsystemOptionsWithEvents.map((subsystem) => (
                      <SelectItem key={subsystem} value={subsystem}>{subsystem}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {!showComparison ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">No comparison selected yet. Pick at least one machine and a comparison type to render charts/tables.</p>
          </CardContent>
        </Card>
      ) : null}

      {showComparison && mode === 'mlc' ? (
        <Card>
          <CardHeader>
            <CardTitle>MLC error profile comparison</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={mlcSummary.chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="machine" />
                <YAxis allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }}
                  labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                  itemStyle={{ color: 'hsl(var(--foreground))' }}
                />
                <Legend />
                <Bar dataKey="Bank A" stackId="a" fill="#06b6d4" />
                <Bar dataKey="Bank B" stackId="a" fill="#84cc16" />
                <Bar dataKey="Hard" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border rounded">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-2">Machine</th>
                    <th className="p-2">Total MLC errors</th>
                    <th className="p-2">Bank A</th>
                    <th className="p-2">Bank B</th>
                    <th className="p-2">Hard errors</th>
                    <th className="p-2">Top motors</th>
                  </tr>
                </thead>
                <tbody>
                  {mlcSummary.rows.map((entry) => (
                    <tr key={`mlc-row-${entry.machineId}`} className="border-b align-top">
                      <td className="p-2">{getMachineLabel(entry.machineId)}</td>
                      <td className="p-2 font-semibold">{entry.totalErrors}</td>
                      <td className="p-2">{entry.bankAErrors}</td>
                      <td className="p-2">{entry.bankBErrors}</td>
                      <td className="p-2">{entry.hardErrors}</td>
                      <td className="p-2">{entry.topMotors.length > 0 ? entry.topMotors.join(', ') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {showComparison && mode === 'statistic' ? (
        <Card>
          <CardHeader>
            <CardTitle>{selectedStatistic ? (chartSettingMap.get(selectedStatistic)?.displayName || selectedStatistic) : 'Select a statistic to compare'}</CardTitle>
          </CardHeader>
          <CardContent>
            {statisticData.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data for the selected statistic in this date range.</p>
            ) : (
              <ResponsiveContainer width="100%" height={340}>
                <LineChart data={statisticData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" dataKey="timestampMs" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(value) => format(new Date(value), 'MMM dd')} />
                  <YAxis domain={statisticYAxis.domain} ticks={statisticYAxis.ticks} interval={0} tickFormatter={(value) => formatYAxisTick(value, statisticYAxis)} width={70} />
                  <Tooltip
                    labelFormatter={(value) => format(new Date(value), 'PPpp')}
                    contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }}
                    labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Legend />
                  {statisticSeries.map((series) => (
                    <Line
                      key={series.dataKey}
                      type="monotone"
                      dataKey={series.dataKey}
                      name={series.name}
                      stroke={series.color}
                      strokeDasharray={series.dashed}
                      dot={false}
                      strokeWidth={2}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      ) : null}

      {showComparison && mode === 'magnetron' ? (
        <Card>
          <CardHeader>
            <CardTitle>Magnetron arcs comparison</CardTitle>
          </CardHeader>
          <CardContent>
            {magnetronData.length === 0 ? (
              <p className="text-sm text-muted-foreground">No magnetron arcs available in the selected range.</p>
            ) : (
              <ResponsiveContainer width="100%" height={340}>
                <LineChart data={magnetronData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" dataKey="dateMs" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(value) => format(new Date(value), 'MMM dd')} />
                  <YAxis />
                  <Tooltip
                    labelFormatter={(value) => format(new Date(value), 'PP')}
                    contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }}
                    labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Legend />
                  {selectedMachines.map((machineId, index) => (
                    <Line
                      key={`arcs-${machineId}`}
                      type="monotone"
                      dataKey={machineId}
                      name={getMachineLabel(machineId)}
                      stroke={['#ef4444', '#3b82f6', '#10b981', '#f59e0b'][index % 4]}
                      dot={false}
                      strokeWidth={2}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      ) : null}

      {showComparison && mode === 'subsystem' ? (
        <Card>
          <CardHeader>
            <CardTitle>{selectedSubsystem} event count comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={subsystemData.map((entry) => ({ machine: getMachineLabel(entry.machineId), count: entry.count }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="machine" />
                <YAxis allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }}
                  labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                  itemStyle={{ color: 'hsl(var(--foreground))' }}
                />
                <Bar dataKey="count" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Find event/error across machines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder='Search for event/error (example: "CoolingcityWaterTempStatistics", "Couch", "1004", "Motor 37")'
            value={lookupQuery}
            onChange={(event) => setLookupQuery(event.target.value)}
          />
          {lookupQuery.trim().length === 0 ? (
            <p className="text-sm text-muted-foreground">Type any event/error text to compare whether other machines had it too.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border rounded">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="p-2">Machine</th>
                      <th className="p-2">Matching errors</th>
                      <th className="p-2">Matching events</th>
                      <th className="p-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventLookup.byMachine.map((entry) => (
                      <tr key={`lookup-${entry.machineId}`} className="border-b">
                        <td className="p-2">{getMachineLabel(entry.machineId)}</td>
                        <td className="p-2">{entry.errorMatches.length}</td>
                        <td className="p-2">{entry.eventMatches.length}</td>
                        <td className="p-2 font-semibold">{entry.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {eventLookup.timeline.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={eventLookup.timeline}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" dataKey="dayMs" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(value) => format(new Date(value), 'MMM dd')} />
                    <YAxis allowDecimals={false} />
                    <Tooltip
                      labelFormatter={(value) => format(new Date(value), 'PP')}
                      contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }}
                      labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
                    />
                    <Legend />
                    {selectedMachines.map((machineId, index) => (
                      <Line
                        key={`lookup-line-${machineId}`}
                        type="monotone"
                        dataKey={machineId}
                        name={getMachineLabel(machineId)}
                        stroke={['#0ea5e9', '#f97316', '#22c55e', '#a855f7'][index % 4]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground">No timeline hits found for the current search in selected machines.</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ComparisonPage;
