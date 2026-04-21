import { useEffect, useMemo, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { useDashboard } from '@/contexts/DashboardContext';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { DateRangeStatusBar } from '@/components/DateRangeStatusBar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { aggregateSeriesDaily, buildYAxis, extractMagnetronArcsSeries, extractStatisticsSeries, formatYAxisTick, SeriesDisplayOptions } from '@/lib/statisticsCharts';

const defaultOptions: SeriesDisplayOptions = { showMin: true, showMax: true, showAvg: true, dailyAggregation: true };

/**
 * Executes `ChartsPage`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export default function ChartsPage() {
  const { filteredEvents, dateRange, setDateRange, selectedMachine } = useDashboard();
  const { config, getMachineLabel } = useAppConfig();
  const [searchParams] = useSearchParams();
  const focusMetric = searchParams.get('focus');
  const selectedMachineLabel = getMachineLabel(selectedMachine);
  const chartRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const series = useMemo(() => {
    const chartSettingMap = new Map(config.chartSettings.map((setting) => [setting.eventName, setting] as const));
    return extractStatisticsSeries(filteredEvents)
      .map((item) => {
        const setting = chartSettingMap.get(item.key);
        return {
          ...item,
          label: setting?.displayName || item.label,
          unit: setting?.unit || '',
          visible: setting?.visible !== false,
          limitMin: setting?.limitMin,
          limitMax: setting?.limitMax,
          setValue: setting?.setValue,
        };
      })
      .filter((item) => item.visible);
  }, [config.chartSettings, filteredEvents]);
  const [optionsByKey, setOptionsByKey] = useState<Record<string, SeriesDisplayOptions>>({});
  const magnetronArcs = useMemo(() => extractMagnetronArcsSeries(filteredEvents), [filteredEvents]);

  const visibleSeries = useMemo(() => {
    if (!focusMetric || focusMetric === 'magnetron-arcs' || series.length <= 1) {
      return series;
    }
    const focusedIndex = series.findIndex((item) => item.key === focusMetric);
    if (focusedIndex === -1) {
      return series;
    }

    const middleIndex = Math.floor(series.length / 2);
    const reordered = [...series];
    const [focusedItem] = reordered.splice(focusedIndex, 1);
    reordered.splice(middleIndex, 0, focusedItem);
    return reordered;
  }, [focusMetric, series]);

  useEffect(() => {
    if (!focusMetric) return;
    const target = chartRefs.current[focusMetric];
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusMetric, visibleSeries]);

  /**
   * Executes `toggle`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const toggle = (key: string, field: keyof SeriesDisplayOptions) => {
    setOptionsByKey((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || defaultOptions), [field]: !(prev[key] || defaultOptions)[field] },
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Statistics Charts for {selectedMachineLabel}</h2>
          <p className="text-muted-foreground">Auto-generated charts from logStatistics messages.</p>
        </div>
        <DateRangeStatusBar />
      </div>

      {visibleSeries.length === 0 ? (
        <p className="text-muted-foreground">No statistics series found in the selected range.</p>
      ) : visibleSeries.map((serie) => {
        const options = optionsByKey[serie.key] || defaultOptions;
        const points = options.dailyAggregation ? aggregateSeriesDaily(serie.points) : serie.points;
        const y = buildYAxis(points, options);
        const latestPoint = points.length > 0 ? points[points.length - 1] : null;
        const latestValue = latestPoint?.avgValue;
        const hasMin = Number.isFinite(serie.limitMin);
        const hasMax = Number.isFinite(serie.limitMax);
        const range = hasMin && hasMax ? (serie.limitMax as number) - (serie.limitMin as number) : null;
        const margin = Number.isFinite(range) && range !== 0
          ? Math.abs(range as number) * 0.1
          : Math.max(Math.abs((serie.limitMax as number) ?? 0), Math.abs((serie.limitMin as number) ?? 0)) * 0.1;
        const isOverLimit = Number.isFinite(latestValue) && (
          (hasMin && (latestValue as number) < (serie.limitMin as number)) ||
          (hasMax && (latestValue as number) > (serie.limitMax as number))
        );
        const isNearLimit = !isOverLimit && Number.isFinite(latestValue) && (
          (hasMin && Math.abs((latestValue as number) - (serie.limitMin as number)) <= margin) ||
          (hasMax && Math.abs((serie.limitMax as number) - (latestValue as number)) <= margin)
        );
        const limitStatusLabel = isOverLimit ? 'Over limit' : isNearLimit ? 'Near limit' : 'Within limits';
        const limitStatusVariant = isOverLimit ? 'destructive' : isNearLimit ? 'default' : 'secondary';

        return (
          <div
            key={serie.key}
            ref={(node) => {
              chartRefs.current[serie.key] = node;
            }}
            className="bg-card rounded-xl border border-border p-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-lg font-semibold">
                {serie.label}
                {serie.unit ? <span className="ml-2 text-sm text-muted-foreground">({serie.unit})</span> : null}
              </h3>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant={options.showMin ? 'default' : 'outline'} onClick={() => toggle(serie.key, 'showMin')}>Min</Button>
                <Button size="sm" variant={options.showMax ? 'default' : 'outline'} onClick={() => toggle(serie.key, 'showMax')}>Max</Button>
                <Button size="sm" variant={options.showAvg ? 'default' : 'outline'} onClick={() => toggle(serie.key, 'showAvg')}>Avg</Button>
                <Button size="sm" variant={options.dailyAggregation ? 'default' : 'outline'} onClick={() => toggle(serie.key, 'dailyAggregation')}>Daily aggregation</Button>
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Badge variant="secondary">{points.length} points {options.dailyAggregation ? '(daily)' : '(raw)'}</Badge>
              {latestPoint && (hasMin || hasMax) ? <Badge variant={limitStatusVariant}>{limitStatusLabel}</Badge> : null}
            </div>

            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={points}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  type="number"
                  dataKey="timestampMs"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(value) => format(new Date(value), options.dailyAggregation ? 'MMM dd, yyyy' : 'MMM dd, yyyy HH:mm')}
                />
                <YAxis
                  width={70}
                  domain={y.domain}
                  ticks={y.ticks}
                  interval={0}
                  tickFormatter={(value) => formatYAxisTick(value, y)}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#000', border: '1px solid #333', color: '#fff' }}
                  labelStyle={{ color: '#fff' }}
                  itemStyle={{ color: '#fff' }}
                  formatter={(value: number, name: string) => [value.toFixed(1), name]}
                  labelFormatter={(_, payload) => {
                    const point = payload?.[0]?.payload as { timestamp?: Date } | undefined;
                    return point?.timestamp ? format(point.timestamp, 'MMM dd, yyyy') : '';
                  }}
                />
                {hasMin ? (
                  <ReferenceLine
                    y={serie.limitMin}
                    stroke="#ef4444"
                    strokeDasharray="5 5"
                    label={{ value: `Min ${serie.limitMin}`, position: 'insideBottomLeft', fill: '#ef4444' }}
                  />
                ) : null}
                {hasMax ? (
                  <ReferenceLine
                    y={serie.limitMax}
                    stroke="#ef4444"
                    strokeDasharray="5 5"
                    label={{ value: `Max ${serie.limitMax}`, position: 'insideTopLeft', fill: '#ef4444' }}
                  />
                ) : null}
                {Number.isFinite(serie.setValue) ? (
                  <ReferenceLine
                    y={serie.setValue}
                    stroke="#a855f7"
                    strokeDasharray="3 3"
                    label={{ value: `Set ${serie.setValue}`, position: 'insideTopRight', fill: '#a855f7' }}
                  />
                ) : null}
                {options.showMin && <Area type="monotone" dataKey="minValue" name="Min" stroke="#22c55e" fill="#22c55e" fillOpacity={0.15} />}
                {options.showMax && <Area type="monotone" dataKey="maxValue" name="Max" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.15} />}
                {options.showAvg && <Area type="monotone" dataKey="avgValue" name="Avg" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} />}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        );
      })}

      {magnetronArcs && (
        <div
          ref={(node) => {
            chartRefs.current['magnetron-arcs'] = node;
          }}
          className="bg-card rounded-xl border border-border p-6 space-y-4"
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-lg font-semibold">Magnetron Arcs</h3>
              <p className="text-sm text-muted-foreground">Total arc count = {magnetronArcs.totalArcCount}</p>
            </div>
            <Badge variant="secondary">{magnetronArcs.points.length} days</Badge>
          </div>

          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={magnetronArcs.points}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                type="number"
                dataKey="dateMs"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(value) => format(new Date(value), 'MMM dd, yyyy')}
              />
              <YAxis allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#000', border: '1px solid #333', color: '#fff' }}
                labelStyle={{ color: '#fff' }}
                itemStyle={{ color: '#fff' }}
                formatter={(value: number) => [value.toFixed(0), 'Arcs']}
                labelFormatter={(_, payload) => {
                  const point = payload?.[0]?.payload as { date?: Date } | undefined;
                  return point?.date ? format(point.date, 'MMM dd, yyyy') : '';
                }}
              />
              <Area type="monotone" dataKey="arcs" name="Arcs" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
