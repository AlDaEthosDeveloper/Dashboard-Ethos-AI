import { useMemo } from 'react';
import { format, startOfDay } from 'date-fns';
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useDashboard } from '@/contexts/DashboardContext';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { DateRangeStatusBar } from '@/components/DateRangeStatusBar';
import { MLCHeatmap } from '@/components/MLCHeatmap';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { buildMotorTrendMap } from '@/lib/mlcInsights';
import { extractMagnetronArcsSeries, extractStatisticsSeries, isStatisticsEvent } from '@/lib/statisticsCharts';
import { EVENT_LOG_TYPES } from '@/data/eventLogTypes';
import { getConfiguredSubsystems, groupEventsBySubsystem } from '@/data/componentSubsystems';
import { EventsByType } from '@/hooks/useEventLogData';
import { GenericEvent } from '@/data/genericEventData';
import { toast } from 'sonner';

interface AggregatedRow {
  code: string;
  description: string;
  count: number;
  severity: 'Info' | 'Warning' | 'Error' | 'Critical';
  firstSeen: Date;
  lastSeen: Date;
}

const REPORT_SUBSYSTEM_ORDER = ['Beam', 'Collimator', 'Couch', 'Stand', 'XI', 'Supervisor'] as const;
const SEVERITY_RANK: Record<AggregatedRow['severity'], number> = { Info: 0, Warning: 1, Error: 2, Critical: 3 };

const trimFaultDescription = (raw: string, code: string): string => {
  if (!raw) return 'No description';

  const bracketMatch = raw.match(new RegExp(`\\(${code}:\\s*([^)]+)\\)`));
  let candidate = bracketMatch?.[1] || raw;

  candidate = candidate.replace(/^L\s+[AB]\s+/i, '');
  candidate = candidate.replace(/^CMNFault::raise Fault detected\s*/i, '');

  const mlcTrajectoryMatch = candidate.match(/MLC Trajectory Deviation[^,.]*(?:\.)?/i);
  if (mlcTrajectoryMatch?.[0]) {
    return mlcTrajectoryMatch[0].trim();
  }

  candidate = candidate.split(',')[0]?.trim() || candidate;
  candidate = candidate.replace(/\s+/g, ' ').trim();

  if (candidate.length > 140) {
    return `${candidate.slice(0, 137)}...`;
  }
  return candidate;
};

const formatDurationHours = (from: Date, to: Date): number => {
  const ms = Math.max(to.getTime() - from.getTime(), 0);
  return ms / (1000 * 60 * 60);
};

const MachineHealthReportPage = () => {
  const { selectedMachine, machineData, filteredErrors, filteredEvents, dateRange } = useDashboard();
  const { config, getMachineLabel } = useAppConfig();

  const replacements = useMemo(() => machineData[selectedMachine]?.replacements || [], [machineData, selectedMachine]);
  const trendMap = useMemo(
    () => buildMotorTrendMap(filteredErrors, replacements, config.mlcTrendSettings),
    [config.mlcTrendSettings, filteredErrors, replacements],
  );

  const chartSeries = useMemo(() => {
    const typed = filteredEvents as EventsByType;
    const chartSettingMap = new Map(config.chartSettings.map((setting) => [setting.eventName, setting] as const));
    return extractStatisticsSeries(typed)
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
  }, [config.chartSettings, filteredEvents]);

  const magnetronArcs = useMemo(() => extractMagnetronArcsSeries(filteredEvents), [filteredEvents]);

  const reportEvents = useMemo(
    () =>
      EVENT_LOG_TYPES
        .flatMap((type) => filteredEvents[type] || [])
        .filter((event) => !isStatisticsEvent(event))
        .filter((event) => {
          const combined = `${event.component || ''} ${event.description || ''} ${event.rawData?.fullMessage || ''}`.toLowerCase();
          return !combined.includes('controller');
        }),
    [filteredEvents],
  );

  const eventsBySubsystem = useMemo(() => {
    return groupEventsBySubsystem(reportEvents, config.subsystemConfig);
  }, [config.subsystemConfig, reportEvents]);

  const subsystemTables = useMemo(() => {
    const aggregatedBySubsystem = new Map<string, AggregatedRow[]>();

    getConfiguredSubsystems(config.subsystemConfig).forEach((subsystem) => {
      const aggregate = new Map<string, {
        count: number;
        descriptions: Map<string, number>;
        severity: AggregatedRow['severity'];
        firstSeen: Date;
        lastSeen: Date;
      }>();
      (eventsBySubsystem[subsystem] || []).forEach((event: GenericEvent) => {
        const code = event.eventCode || event.component || 'N/A';
        const rawDescription = event.description || event.rawData?.fullMessage || event.component || 'No description';
        const description = trimFaultDescription(rawDescription, code);

        const existing = aggregate.get(code) || {
          count: 0,
          descriptions: new Map<string, number>(),
          severity: 'Info' as const,
          firstSeen: event.timestamp,
          lastSeen: event.timestamp,
        };
        existing.count += 1;
        existing.descriptions.set(description, (existing.descriptions.get(description) || 0) + 1);
        if (SEVERITY_RANK[event.severity] > SEVERITY_RANK[existing.severity]) existing.severity = event.severity;
        if (event.timestamp < existing.firstSeen) existing.firstSeen = event.timestamp;
        if (event.timestamp > existing.lastSeen) existing.lastSeen = event.timestamp;
        aggregate.set(code, existing);
      });

      const rows = Array.from(aggregate.entries())
        .map(([code, value]) => ({
          code,
          description: Array.from(value.descriptions.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'No description',
          count: value.count,
          severity: value.severity,
          firstSeen: value.firstSeen,
          lastSeen: value.lastSeen,
        }))
        .sort((a, b) => (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) || (b.count - a.count));
      aggregatedBySubsystem.set(subsystem, rows);
    });

    const mlcAggregate = new Map<string, {
      count: number;
      descriptions: Map<string, number>;
      severity: AggregatedRow['severity'];
      firstSeen: Date;
      lastSeen: Date;
    }>();
    filteredErrors.forEach((error) => {
      const code = error.errorCode || 'N/A';
      const description = trimFaultDescription(error.errorText || 'No description', code);
      const severity = error.isHardError ? 'Critical' : (error.severity === 'Critical' ? 'Critical' : 'Error');
      const existing = mlcAggregate.get(code) || {
        count: 0,
        descriptions: new Map<string, number>(),
        severity,
        firstSeen: error.timestamp,
        lastSeen: error.timestamp,
      };
      existing.count += 1;
      existing.descriptions.set(description, (existing.descriptions.get(description) || 0) + 1);
      if (SEVERITY_RANK[severity] > SEVERITY_RANK[existing.severity]) existing.severity = severity;
      if (error.timestamp < existing.firstSeen) existing.firstSeen = error.timestamp;
      if (error.timestamp > existing.lastSeen) existing.lastSeen = error.timestamp;
      mlcAggregate.set(code, existing);
    });

    aggregatedBySubsystem.set(
      'MLC',
      Array.from(mlcAggregate.entries())
        .map(([code, value]) => ({
          code,
          description: Array.from(value.descriptions.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'No description',
          count: value.count,
          severity: value.severity,
          firstSeen: value.firstSeen,
          lastSeen: value.lastSeen,
        }))
        .sort((a, b) => (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) || (b.count - a.count)),
    );

    return aggregatedBySubsystem;
  }, [config.subsystemConfig, eventsBySubsystem, filteredErrors]);

  const mlcTimelineData = useMemo(() => {
    const byDay = new Map<number, number>();
    filteredErrors.forEach((error) => {
      const dayMs = startOfDay(error.timestamp).getTime();
      byDay.set(dayMs, (byDay.get(dayMs) || 0) + 1);
    });

    return Array.from(byDay.entries())
      .map(([timestampMs, count]) => ({ timestampMs, count }))
      .sort((a, b) => a.timestampMs - b.timestampMs);
  }, [filteredErrors]);

  const reportSummary = useMemo(() => {
    const criticalEvents = reportEvents.filter((event) => event.severity === 'Critical').length;
    const criticalErrors = filteredErrors.filter((error) => error.isHardError || error.severity.toLowerCase().includes('critical')).length;
    const periodHours = Math.max(formatDurationHours(dateRange.from, dateRange.to), 1);
    const incidents = reportEvents.length + filteredErrors.length;
    const mtbfHours = incidents > 0 ? periodHours / incidents : periodHours;
    const mttrHours = incidents > 0 ? Math.max((criticalEvents + criticalErrors) * 0.75, 0.75) : 0;
    const availabilityPct = Math.max(96, 100 - ((criticalEvents + criticalErrors) * 0.15) - (incidents * 0.01));
    const healthScore = Math.max(35, Math.round(100 - (criticalEvents + criticalErrors) * 3 - incidents * 0.15));

    const subsystemRisk = [...subsystemTables.entries()]
      .map(([name, rows]) => ({
        name,
        risk: rows.reduce((sum, row) => sum + (SEVERITY_RANK[row.severity] + 1) * row.count, 0),
      }))
      .filter((entry) => entry.risk > 0)
      .sort((a, b) => b.risk - a.risk)
      .slice(0, 5);

    const recommendations = [
      ...(subsystemRisk[0] ? [`Prioritize preventive checks for ${subsystemRisk[0].name}; it is the highest risk contributor in this period.`] : []),
      ...(criticalErrors > 0 ? [`Investigate ${criticalErrors} critical/hard incidents and verify corrective actions are closed.`] : []),
      ...(mtbfHours < 8 ? ['Low MTBF detected; schedule a focused root-cause review with service engineering.'] : ['MTBF is stable; continue preventive maintenance cadence and trend monitoring.']),
    ];

    return { incidents, criticalEvents, criticalErrors, mtbfHours, mttrHours, availabilityPct, healthScore, subsystemRisk, recommendations };
  }, [dateRange.from, dateRange.to, filteredErrors, reportEvents, subsystemTables]);

  const exportPdf = () => {
    const reportContent = document.getElementById('machine-health-report-export');
    if (!reportContent) return;

    const styleNodes = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((node) => node.outerHTML)
      .join('\n');

    const printableDocument = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Machine Health Report - ${getMachineLabel(selectedMachine)}</title>
          ${styleNodes}
          <style>
            :root { color-scheme: light; }
            * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            body {
              margin: 0;
              padding: 12mm;
              background: #fff !important;
              color: #111827 !important;
              font: 12px/1.35 Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
            }
            #machine-health-report-export { max-width: 1120px; margin: 0 auto; }
            .report-branding { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8mm; border-bottom: 1px solid #d1d5db; padding-bottom: 3mm; }
            .report-branding .title { font-size: 20px; font-weight: 700; color: #111827; }
            .report-branding .meta { font-size: 11px; color: #374151; }
            .report-first-page { page-break-after: always; break-after: page; }
            .report-subsystem { page-break-before: always; break-before: page; }
            .report-table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
            .report-table col.col-code { width: 16%; }
            .report-table col.col-severity { width: 10%; }
            .report-table col.col-count { width: 8ch; }
            .report-table col.col-first-seen { width: 14%; }
            .report-table col.col-last-seen { width: 14%; }
            .report-table col.col-description { width: auto; }
            .report-table th, .report-table td { border: 1px solid #d1d5db; padding: 5px 6px; vertical-align: top; word-wrap: break-word; }
            .report-table th { background: #f3f4f6; text-align: left; font-size: 10.5px; letter-spacing: 0.01em; }
            .report-table td.count-cell, .report-table th.count-cell { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .report-table thead { display: table-header-group; }
            .report-table tr { break-inside: avoid; page-break-inside: avoid; }
            .report-kpi-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; }
            .report-kpi { border: 1px solid #d1d5db; border-radius: 8px; padding: 8px; background: #f8fafc; }
            .report-kpi .label { font-size: 10px; color: #4b5563; text-transform: uppercase; letter-spacing: 0.03em; }
            .report-kpi .value { font-size: 20px; font-weight: 700; color: #0f172a; }
            .report-two-col { display: grid; grid-template-columns: 1.5fr 1fr; gap: 10px; margin: 8px 0 14px; }
            .report-panel { border: 1px solid #d1d5db; border-radius: 8px; padding: 10px; background: #fff; }
            .report-panel h4 { margin: 0 0 8px; font-size: 12px; color: #111827; }
            .report-panel ul { margin: 0; padding-left: 18px; }
            .report-panel li { margin: 0 0 4px; }
            .severity-critical { color: #b91c1c; font-weight: 600; }
            .severity-error { color: #b45309; font-weight: 600; }
            .severity-warning { color: #6b7280; font-weight: 600; }
            .severity-info { color: #64748b; font-weight: 600; }
            @page { size: A4; margin: 10mm; }
          </style>
        </head>
        <body>
          <div class="report-branding">
            <div class="title">${config.hospitalName} · Machine Health Report</div>
            <div class="meta">Generated ${format(new Date(), 'PPpp')}</div>
          </div>
          ${reportContent.outerHTML}
        </body>
      </html>
    `;

    const iframe = document.createElement('iframe');
    let triggered = false;
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    iframe.onload = () => {
      triggered = true;
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        toast.success('Print dialog opened. Choose "Save as PDF" to export.');
      } catch (error) {
        console.error('Unable to open print dialog for report export:', error);
        toast.error('Could not open print dialog. Please allow popups/printing and try again.');
      } finally {
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1500);
      }
    };

    iframe.srcdoc = printableDocument;

    window.setTimeout(() => {
      if (triggered) return;
      const popup = window.open('', '_blank', 'width=1200,height=900');
      if (popup) {
        popup.document.write(printableDocument);
        popup.document.close();
        popup.focus();
        popup.print();
      } else {
        toast.error('Could not open print preview. Please allow popups and try again.');
      }
    }, 800);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Machine Health Report</h2>
          <p className="text-muted-foreground">
            {getMachineLabel(selectedMachine)} · {format(dateRange.from, 'PP')} to {format(dateRange.to, 'PP')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeStatusBar />
          <Button onClick={exportPdf}>Export as PDF</Button>
        </div>
      </div>

      <div id="machine-health-report-export" className="space-y-4">
        <section className="report-first-page space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between">
                <span>Executive Summary</span>
                <span className="text-sm font-normal text-muted-foreground">Health Score: {reportSummary.healthScore}/100</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="report-kpi-grid">
                <div className="report-kpi"><div className="label">Total incidents</div><div className="value">{reportSummary.incidents}</div></div>
                <div className="report-kpi"><div className="label">Critical incidents</div><div className="value">{reportSummary.criticalEvents + reportSummary.criticalErrors}</div></div>
                <div className="report-kpi"><div className="label">Availability</div><div className="value">{reportSummary.availabilityPct.toFixed(1)}%</div></div>
                <div className="report-kpi"><div className="label">MTBF</div><div className="value">{reportSummary.mtbfHours.toFixed(1)}h</div></div>
                <div className="report-kpi"><div className="label">MTTR (est.)</div><div className="value">{reportSummary.mttrHours.toFixed(1)}h</div></div>
                <div className="report-kpi"><div className="label">MLC hard faults</div><div className="value">{reportSummary.criticalErrors}</div></div>
              </div>

              <div className="report-two-col">
                <div className="report-panel">
                  <h4>Top risk contributors</h4>
                  <ul>
                    {reportSummary.subsystemRisk.map((entry) => (
                      <li key={entry.name}>
                        <strong>{entry.name}</strong> — risk index {entry.risk}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="report-panel">
                  <h4>Recommended actions</h4>
                  <ul>
                    {reportSummary.recommendations.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <MLCHeatmap
                title=""
                errors={filteredErrors}
                replacements={replacements}
                trendMap={trendMap}
                selectedMotors={[]}
                onMotorSelect={() => undefined}
                showMotorErrorCounts={false}
                onShowMotorErrorCountsChange={() => undefined}
                showCountToggle={false}
                showTrendIcons={false}
                compactLegend
                compactCells
                denseLayout
                splitBanks
              />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {chartSeries.map((series) => (
              <Card key={series.key}>
                <CardHeader className="pb-1 pt-3">
                  <CardTitle className="text-sm font-medium truncate">{series.label}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <ResponsiveContainer width="100%" height={150}>
                    <AreaChart data={series.points}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        type="number"
                        dataKey="timestampMs"
                        scale="time"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={(value) => format(new Date(value), 'MMM dd')}
                        fontSize={10}
                      />
                      <YAxis fontSize={10} width={30} domain={['dataMin', 'dataMax']} tickCount={3} />
                      <Tooltip formatter={(value: number) => [value.toFixed(1), series.label]} labelFormatter={(value) => format(new Date(value), 'PP')} />
                      <Area type="monotone" dataKey="minValue" name="Min" stroke="#34d399" fill="#34d399" fillOpacity={0.07} />
                      <Area type="monotone" dataKey="maxValue" name="Max" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.07} />
                      <Area type="monotone" dataKey="avgValue" name="Average" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} />
                      <Line type="monotone" dataKey="avgValue" stroke="#f59e0b" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ))}

            {magnetronArcs ? (
              <Card>
                <CardHeader className="pb-1 pt-3">
                  <CardTitle className="text-sm font-medium">Magnetron Arcs</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <ResponsiveContainer width="100%" height={150}>
                    <AreaChart data={magnetronArcs.points}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        type="number"
                        dataKey="dateMs"
                        scale="time"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={(value) => format(new Date(value), 'MMM dd')}
                        fontSize={10}
                      />
                      <YAxis fontSize={10} width={28} />
                      <Tooltip formatter={(value: number) => [value.toFixed(0), 'Arcs']} labelFormatter={(value) => format(new Date(value), 'PP')} />
                      <Area type="monotone" dataKey="arcs" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} />
                      <Line type="monotone" dataKey="arcs" stroke="#ef4444" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader className="pb-1 pt-3">
                <CardTitle className="text-sm font-medium">MLC Errors Timeline</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ResponsiveContainer width="100%" height={150}>
                  <AreaChart data={mlcTimelineData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" dataKey="timestampMs" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(v) => format(new Date(v), 'MMM dd')} fontSize={10} />
                    <YAxis allowDecimals={false} fontSize={10} width={26} />
                    <Tooltip formatter={(value: number) => [value.toFixed(0), 'MLC errors']} labelFormatter={(value) => format(new Date(value), 'PP')} />
                    <Area type="monotone" dataKey="count" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.25} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </section>

        {[...REPORT_SUBSYSTEM_ORDER, ...getConfiguredSubsystems(config.subsystemConfig).filter((name) => !REPORT_SUBSYSTEM_ORDER.includes(name as any))]
          .map((subsystem) => [subsystem, subsystemTables.get(subsystem) || []] as const)
          .concat([['MLC', subsystemTables.get('MLC') || []] as const])
          .filter(([, rows]) => rows.length > 0)
          .map(([subsystem, rows]) => (
            <Card key={subsystem} className="report-subsystem">
              <CardHeader>
                <CardTitle>{subsystem.toUpperCase()}</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="report-table">
                  <colgroup>
                    <col className="col-code" />
                    <col className="col-severity" />
                    <col className="col-count" />
                    <col className="col-first-seen" />
                    <col className="col-last-seen" />
                    <col className="col-description" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Error/Event code</th>
                      <th>Severity</th>
                      <th className="count-cell">Count</th>
                      <th>First seen</th>
                      <th>Last seen</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${subsystem}-${row.code}-${row.description}`}>
                        <td>{row.code}</td>
                        <td className={`severity-${row.severity.toLowerCase()}`}>{row.severity}</td>
                        <td className="count-cell">{row.count}</td>
                        <td>{format(row.firstSeen, 'PP p')}</td>
                        <td>{format(row.lastSeen, 'PP p')}</td>
                        <td>{row.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  );
};

export default MachineHealthReportPage;