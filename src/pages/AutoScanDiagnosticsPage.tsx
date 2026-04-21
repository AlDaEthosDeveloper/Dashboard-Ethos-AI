import { ChangeEvent, useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useUpload } from '@/contexts/UploadContext';
import { useDashboard } from '@/contexts/DashboardContext';
import { useAppConfig } from '@/contexts/AppConfigContext';

/**
 * Executes `AutoScanDiagnosticsPage`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
const AutoScanDiagnosticsPage = () => {
  const { getMachineLabel, config, importDesktopConfigFromDefaults } = useAppConfig();
  const { runDesktopAutoScanNow, importDesktopBackupJsonFile, desktopAutoScanReport, isScanning } = useUpload();
  const {
    selectedMachine,
    filteredErrors,
    filteredEvents,
    replacementAutoImportReport,
    runReplacementAutoImportNow,
    machineLastRunStatusByMachine,
  } = useDashboard();

  const totalEvents = Object.values(filteredEvents).reduce((acc, items) => acc + items.length, 0);
  const selectedMachineLabel = getMachineLabel(selectedMachine);
  const [configImportLogs, setConfigImportLogs] = useState<string[]>([]);
  const autoScanThresholdMs = Math.max(1, config.autoScanOverdueMinutes) * 60 * 1000;
  const machineLastRunThresholdMs = Math.max(1, config.machineLastRunOverdueMinutes) * 60 * 1000;

  const parseTxtTimestamp = (value: string | null) => {
    if (!value) return null;
    const parsed = new Date(value.replace(' ', 'T')).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  };

  const handleManualJsonUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await importDesktopBackupJsonFile(file);
    event.target.value = '';
  };

  const runConfigDiagnostics = async () => {
    const report = await importDesktopConfigFromDefaults({ applyConfig: true, verbose: true });
    const lines = [
      `run=${new Date().toISOString()}`,
      `configuredDesktopConfigPath=${config.desktopConfigPath || '(not set)'}`,
      ...report.attempts.map((attempt) => `${attempt.status.toUpperCase()} ${attempt.path} :: ${attempt.detail}`),
      report.loadedPath ? `loadedPath=${report.loadedPath}` : `error=${report.error || 'No config file found'}`,
    ];
    lines.forEach((line) => console.info('[AutoScanDiagnostics][config-import]', line));
    setConfigImportLogs(lines);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Auto-scan diagnostics</h2>
        <p className="text-muted-foreground">
          Run desktop auto-scan on demand and inspect exactly what was scanned and restored.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Run test scan</CardTitle>
          <CardDescription>
            Uses the same desktop auto-scan path as startup/watch mode.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => void runDesktopAutoScanNow()} disabled={isScanning}>
              {isScanning ? 'Scanning...' : 'Run desktop auto-scan now (new + modified files)'}
            </Button>
            <Button variant="secondary" onClick={() => void runDesktopAutoScanNow({ forceReprocessKnown: true })} disabled={isScanning}>
              {isScanning ? 'Scanning...' : 'Force reprocess all JSON files'}
            </Button>
            <Button variant="outline" onClick={() => void runReplacementAutoImportNow()}>
              Run replacements Excel import now
            </Button>
          </div>
          <div className="pt-3">
            <label className="text-sm font-medium">Manual JSON test file</label>
            <input type="file" accept=".json,application/json" onChange={(e) => void handleManualJsonUpload(e)} className="mt-2 block" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ethos config import diagnostics</CardTitle>
          <CardDescription>Debug where ethos_config.json is searched and trigger a manual import from the 3 allowed locations.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="secondary" onClick={() => void runConfigDiagnostics()}>
            Run config lookup diagnostics + import
          </Button>
          <div className="text-xs text-muted-foreground">
            Current configured config path: <span className="font-mono">{config.desktopConfigPath || '(not configured)'}</span>
          </div>
          <div className="rounded-md border bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap">
            {configImportLogs.length > 0 ? configImportLogs.join('\n') : 'No config diagnostics run yet.'}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Latest desktop auto-scan report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {desktopAutoScanReport ? (
            <>
              <div className={(Date.now() - new Date(desktopAutoScanReport.ranAt).getTime()) > autoScanThresholdMs ? 'text-destructive' : ''}>
                <strong>Checked time:</strong> {format(new Date(desktopAutoScanReport.ranAt), 'PPpp')}
              </div>
              <div><strong>Configured path:</strong> {desktopAutoScanReport.configuredPath}</div>
              <div>
                <strong>Latest JSON modified / processor last-run timestamp:</strong>{' '}
                <span
                  className={
                    desktopAutoScanReport.latestJsonModifiedAt &&
                    (Date.now() - new Date(desktopAutoScanReport.latestJsonModifiedAt).getTime()) > autoScanThresholdMs
                      ? 'text-destructive'
                      : ''
                  }
                >
                  {desktopAutoScanReport.latestJsonModifiedAt ? format(new Date(desktopAutoScanReport.latestJsonModifiedAt), 'PPpp') : 'N/A'}
                </span>
              </div>
              <div><strong>JSON files seen:</strong> {desktopAutoScanReport.scannedJsonFiles}</div>
              <div><strong>JSON files processed:</strong> {desktopAutoScanReport.processedJsonFiles}</div>
              <div><strong>Items restored:</strong> {desktopAutoScanReport.restoredItems}</div>
              {desktopAutoScanReport.scanError && (
                <div className="text-destructive"><strong>Scan error:</strong> {desktopAutoScanReport.scanError}</div>
              )}
              {desktopAutoScanReport.skippedReason && (
                <div><strong>Skipped reason:</strong> {desktopAutoScanReport.skippedReason}</div>
              )}
              <div className="pt-2">
                <strong>Per-file restore:</strong>
                <ul className="list-disc ml-6 mt-1">
                  {desktopAutoScanReport.files.map((file) => (
                    <li key={file.path}>
                      {file.path} — restored {file.restoredItems}
                      {file.status ? ` (${file.status})` : ''}
                      {file.detail ? `: ${file.detail}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <div>No scan report yet.</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Machine last-copy-run TXT diagnostics</CardTitle>
          <CardDescription>Shows the configured TXT path, parsed timestamp value, and error details per machine.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {Object.keys(machineLastRunStatusByMachine).length === 0 ? (
            <div>No machine last-run paths configured yet.</div>
          ) : (
            <ul className="space-y-2">
              {Object.entries(machineLastRunStatusByMachine).map(([machineId, status]) => (
                <li key={machineId} className="rounded border p-2">
                  <div><strong>{machineId}</strong></div>
                  <div><strong>Path:</strong> {status.path || '(not configured)'}</div>
                  <div
                    className={(() => {
                      const parsedMs = parseTxtTimestamp(status.timestamp);
                      return parsedMs !== null && (Date.now() - parsedMs > machineLastRunThresholdMs) ? 'text-destructive' : '';
                    })()}
                  >
                    <strong>Parsed timestamp:</strong> {status.timestamp || 'N/A'}
                  </div>
                  <div className={(Date.now() - new Date(status.checkedAt).getTime()) > machineLastRunThresholdMs ? 'text-destructive' : ''}>
                    <strong>Checked time:</strong> {format(new Date(status.checkedAt), 'PPpp')}
                  </div>
                  {status.error ? <div className="text-destructive"><strong>Error:</strong> {status.error}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Latest replacements Excel auto-import report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {replacementAutoImportReport ? (
            <>
              <div><strong>Checked time:</strong> {format(new Date(replacementAutoImportReport.ranAt), 'PPpp')}</div>
              <div><strong>Configured path:</strong> {replacementAutoImportReport.configuredPath}</div>
              <div><strong>Status:</strong> {replacementAutoImportReport.status}</div>
              <div><strong>Rows parsed:</strong> {replacementAutoImportReport.totalCount}</div>
              <div>
                <strong>Per machine:</strong>
                <ul className="list-disc ml-6 mt-1">
                  {Object.entries(replacementAutoImportReport.perMachine).map(([machineId, count]) => (
                    <li key={machineId}>{machineId}: {count}</li>
                  ))}
                </ul>
              </div>
              {replacementAutoImportReport.error && (
                <div className="text-destructive"><strong>Error:</strong> {replacementAutoImportReport.error}</div>
              )}
            </>
          ) : (
            <div>No replacements import report yet.</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dashboard state check ({selectedMachineLabel})</CardTitle>
          <CardDescription>
            Confirms whether restored data reached the dashboard stores.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div><strong>Errors in range:</strong> {filteredErrors.length}</div>
          <div><strong>Events in range:</strong> {totalEvents}</div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AutoScanDiagnosticsPage;
