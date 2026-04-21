import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cpu } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { endOfDay, format, startOfDay } from 'date-fns';
import { useDashboard } from '@/contexts/DashboardContext';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { DateRangeStatusBar } from '@/components/DateRangeStatusBar';
import { ErrorTimeline } from '@/components/ErrorTimeline';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EVENT_LOG_TYPES } from '@/data/eventLogTypes';
import { getConfiguredSubsystems, getSubsystemColor, getSubsystemLabel, groupEventsBySubsystem } from '@/data/componentSubsystems';
import { GenericEvent } from '@/data/genericEventData';
import { cn } from '@/lib/utils';
import { aggregateSeriesDaily, buildCountYAxis, buildYAxis, extractMagnetronArcsSeries, extractStatisticsSeries, filterOutStatisticsEvents, formatYAxisTick } from '@/lib/statisticsCharts';

const AllFaultsPage = () => {
  const navigate = useNavigate();
  const { selectedMachine, filteredErrors, filteredEvents, dateRange, setDateRange } = useDashboard();
  const { config, getMachineLabel } = useAppConfig();
  const selectedMachineLabel = getMachineLabel(selectedMachine);

  // Events without statistics (those go to Charts page only)
  const faultEvents = useMemo(() => filterOutStatisticsEvents(filteredEvents), [filteredEvents]);

  const stats = useMemo(() => {
    const mlcErrors = filteredErrors.length;
    const hardErrors = filteredErrors.filter(e => e.isHardError).length;
    let totalOtherEvents = 0;
    let warningEvents = 0;
    let errorEvents = 0;

    EVENT_LOG_TYPES.forEach(type => {
      const events = faultEvents[type] || [];
      totalOtherEvents += events.length;
      warningEvents += events.filter((e) => e.severity === 'Warning').length;
      errorEvents += events.filter((e) => e.severity === 'Error' || e.severity === 'Critical').length;
    });

    const motorCounts: Record<number, number> = {};
    filteredErrors.forEach(e => { motorCounts[e.mlcMotor] = (motorCounts[e.mlcMotor] || 0) + 1; });
    const worstMotor = Object.entries(motorCounts).sort((a, b) => b[1] - a[1])[0];

    return {
      totalFaults: mlcErrors + totalOtherEvents,
      mlcErrors,
      hardErrors,
      totalOtherEvents,
      warningEvents,
      errorEvents,
      worstMotor: worstMotor ? { motor: parseInt(worstMotor[0]), count: worstMotor[1] } : null
    };
  }, [filteredErrors, faultEvents]);

  const statisticsSeries = useMemo(() => {
    const chartSettingMap = new Map(config.chartSettings.map((setting) => [setting.eventName, setting] as const));
    return extractStatisticsSeries(filteredEvents)
      .map((series) => {
        const setting = chartSettingMap.get(series.key);
        return {
          ...series,
          label: setting?.displayName || series.label,
          unit: setting?.unit || '',
          visible: setting?.visible !== false,
        };
      })
      .filter((series) => series.visible);
  }, [config.chartSettings, filteredEvents]);
  const magnetronArcs = useMemo(() => extractMagnetronArcsSeries(filteredEvents), [filteredEvents]);
  const hasData = stats.totalFaults > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Overview</h2>
          <p className="text-muted-foreground">Combined view of all faults, events and charts for {selectedMachineLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeStatusBar />
        </div>
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Cpu className="w-16 h-16 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No Data for {selectedMachineLabel}</h3>
          <p className="text-muted-foreground max-w-md">Upload data via the Upload page to start analyzing faults for this machine.</p>
        </div>
      ) : (
        <>

          {(() => {
            const allEvents: GenericEvent[] = [];
            EVENT_LOG_TYPES.forEach(type => (faultEvents[type] || []).forEach(e => allEvents.push(e)));
            const bySubsystem = groupEventsBySubsystem(allEvents, config.subsystemConfig);
            const subsystemsWithEvents = getConfiguredSubsystems(config.subsystemConfig).filter((t) => (bySubsystem[t] || []).length > 0);
            if (subsystemsWithEvents.length === 0) return null;
            return (
              <div className="bg-card rounded-xl border border-border p-6">
                <h3 className="text-lg font-semibold text-foreground mb-4">Events by Subsystem</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-8 gap-3">
                <div onClick={() => navigate('/other')} className="cursor-pointer p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-2 mb-2"><span className="font-medium text-sm">All Events</span></div>
                    <div className="text-2xl font-bold">{stats.totalOtherEvents}</div>
                    <div className="text-xs text-muted-foreground">{stats.warningEvents} warnings, {stats.errorEvents} errors</div>
                </div>
                <div onClick={() => navigate('/mlc')} className="cursor-pointer p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-2 mb-2"><span className="font-medium text-sm">MLC Errors</span></div>
                    <div className="text-2xl font-bold">{stats.mlcErrors}</div>
                    <div className="text-xs text-muted-foreground">{stats.hardErrors} hard errors</div>
                </div>
                  {subsystemsWithEvents.map((subsystem, index) => (
                    <div key={subsystem} onClick={() => navigate(`/other?subsystem=${subsystem}`)} className="cursor-pointer p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-2 mb-2"><span className={cn('w-3 h-3 rounded-full', getSubsystemColor(subsystem, index))} /><span className="font-medium text-sm">{subsystem}</span></div>
                      <div className="text-2xl font-bold">{(bySubsystem[subsystem] || []).length}</div>
                      <div className="text-xs text-muted-foreground">{getSubsystemLabel(subsystem)}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}



          {(statisticsSeries.length > 0 || magnetronArcs) && (
            <div className="bg-card rounded-xl border border-border p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Statistics Charts</h3>
                <Button size="sm" variant="outline" onClick={() => navigate('/charts')}>Open Charts Page</Button>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

               {magnetronArcs && (
                  (() => {
                    const maxArcs = magnetronArcs.points.reduce((max, point) => Math.max(max, point.arcs), 0);
                    const yAxis = buildCountYAxis(maxArcs);

                    return (
                      <div className="border rounded-lg p-3 cursor-pointer hover:bg-muted/40" onClick={() => navigate('/charts?focus=magnetron-arcs')}>
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-medium text-sm">Magnetron Arcs</p>
                          <Badge variant="secondary">Total {magnetronArcs.totalArcCount}</Badge>
                        </div>
                        <ResponsiveContainer width="100%" height={180}>
                          <AreaChart data={magnetronArcs.points}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis type="number" dataKey="dateMs" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(v) => format(new Date(v), 'MMM dd, yyyy')} />
                            <YAxis allowDecimals={false} width={60} domain={yAxis.domain} ticks={yAxis.ticks} interval={0} />
                            <Tooltip contentStyle={{ backgroundColor: '#000', border: '1px solid #333', color: '#fff' }} labelStyle={{ color: '#fff' }} itemStyle={{ color: '#fff' }} formatter={(value: number) => [value.toFixed(0), 'Arcs']} labelFormatter={(_, payload) => { const point = payload?.[0]?.payload as { date?: Date } | undefined; return point?.date ? format(point.date, 'MMM dd, yyyy') : ''; }} />
                            <Area type="monotone" dataKey="arcs" name="Arcs" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })()
                )}

          {filteredErrors.length > 0 && (
              <ErrorTimeline
                errors={filteredErrors}
                dateRange={dateRange}
                selectedMotors={[]}
                onDaySelect={(day) => {
                  setDateRange({ from: startOfDay(day), to: endOfDay(day) });
                  navigate('/mlc');
                }}
              />
          )}
                {statisticsSeries.map((series) => {
                  const points = aggregateSeriesDaily(series.points);
                  const y = buildYAxis(points, { showMin: true, showMax: true, showAvg: true, dailyAggregation: true });
                  return (

                    <div key={series.key} className="border rounded-lg p-3 cursor-pointer hover:bg-muted/40" onClick={() => navigate(`/charts?focus=${encodeURIComponent(series.key)}`)}>

                      <div className="flex items-center justify-between mb-2">
                        <p className="font-medium text-sm">{series.label}{series.unit ? ` (${series.unit})` : ''}</p>
                        <Badge variant="secondary">daily</Badge>
                      </div>
                      <ResponsiveContainer width="100%" height={180}>
                        <AreaChart data={points}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis type="number" dataKey="timestampMs" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(v) => format(new Date(v), 'MMM dd, yyyy')} />
                          <YAxis domain={y.domain} ticks={y.ticks} interval={0} tickFormatter={(v) => formatYAxisTick(v, y)} width={60} />
                          <Tooltip contentStyle={{ backgroundColor: '#000', border: '1px solid #333', color: '#fff' }} labelStyle={{ color: '#fff' }} itemStyle={{ color: '#fff' }} formatter={(value: number, name: string) => [value.toFixed(1), name]} labelFormatter={(_, payload) => { const point = payload?.[0]?.payload as { timestamp?: Date } | undefined; return point?.timestamp ? format(point.timestamp, 'MMM dd, yyyy') : ''; }} />
                          <Area type="monotone" dataKey="minValue" name="Min" stroke="#22c55e" fill="#22c55e" fillOpacity={0.1} />
                          <Area type="monotone" dataKey="maxValue" name="Max" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.1} />
                          <Area type="monotone" dataKey="avgValue" name="Avg" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AllFaultsPage;
