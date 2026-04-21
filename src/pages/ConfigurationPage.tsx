import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleHelp, Download, Moon, Plus, Save, Sun, Trash2, Upload, WandSparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAppConfig, ChartSetting, MlcTrendSettings } from '@/contexts/AppConfigContext';
import { useDashboard } from '@/contexts/DashboardContext';
import { useTheme } from '@/contexts/ThemeContext';
import { extractStatisticsSeries } from '@/lib/statisticsCharts';
import { GenericEvent } from '@/data/genericEventData';
import { APP_PAGES, DEFAULT_PAGE_VISIBILITY, type AppPageKey } from '@/lib/pageRegistry';
import { isTauriRuntime, tauriPath } from '@/lib/tauriBridge';
import { toast } from 'sonner';
import { DEFAULT_SUBSYSTEMS, getSubsystemFromComponent, type EventOperationalMode } from '@/data/componentSubsystems';

type LogTypeAssignmentRow = {
  logType: string;
  subsystem: string;
  mode: EventOperationalMode;
};

const CONFIG_FILENAME = 'ethos_config.json';

const getConfigSaveLocations = async () => {
  if (!isTauriRuntime()) return [];

  const locations: string[] = [];
  try {
    const executableDir = await tauriPath.executableDir();
    locations.push(await tauriPath.join(executableDir, CONFIG_FILENAME));
  } catch {
    // ignore unavailable path
  }

  try {
    const appConfigDir = await tauriPath.appConfigDir();
    locations.push(await tauriPath.join(appConfigDir, CONFIG_FILENAME));
  } catch {
    // ignore unavailable path
  }

  return [...new Set(locations)];
};

const MLC_DEFAULTS: MlcTrendSettings = {
  minIncidentDaysForTrend: 4,
  minIncidentDaysForDirection: 6,
  rateDiffThreshold: 0.12,
  intervalDiffThresholdDays: 3,
};

const normalizeMlcSettings = (input: Partial<MlcTrendSettings>): MlcTrendSettings => {
  const minIncidentDaysForTrendRaw = Number(input.minIncidentDaysForTrend);
  const minIncidentDaysForTrend = Number.isFinite(minIncidentDaysForTrendRaw)
    ? Math.max(2, Math.round(minIncidentDaysForTrendRaw))
    : MLC_DEFAULTS.minIncidentDaysForTrend;

  const minIncidentDaysForDirectionRaw = Number(input.minIncidentDaysForDirection);
  const minIncidentDaysForDirection = Number.isFinite(minIncidentDaysForDirectionRaw)
    ? Math.max(minIncidentDaysForTrend, Math.round(minIncidentDaysForDirectionRaw))
    : Math.max(minIncidentDaysForTrend, MLC_DEFAULTS.minIncidentDaysForDirection);

  const rateDiffThresholdRaw = Number(input.rateDiffThreshold);
  const rateDiffThreshold = Number.isFinite(rateDiffThresholdRaw)
    ? Math.max(0, rateDiffThresholdRaw)
    : MLC_DEFAULTS.rateDiffThreshold;

  const intervalDiffThresholdDaysRaw = Number(input.intervalDiffThresholdDays);
  const intervalDiffThresholdDays = Number.isFinite(intervalDiffThresholdDaysRaw)
    ? Math.max(0, intervalDiffThresholdDaysRaw)
    : MLC_DEFAULTS.intervalDiffThresholdDays;

  return {
    minIncidentDaysForTrend,
    minIncidentDaysForDirection,
    rateDiffThreshold,
    intervalDiffThresholdDays,
  };
};

const ConfigurationPage = () => {
  const { config, updateConfig, exportConfig, importConfig } = useAppConfig();
  const { eventData } = useDashboard();
  const { theme, setTheme } = useTheme();

  const [hospitalName, setHospitalName] = useState(config.hospitalName);
  const [databaseDirectory, setDatabaseDirectory] = useState(config.databaseDirectory || '');
  const [desktopConfigPath, setDesktopConfigPath] = useState(config.desktopConfigPath || '');
  const [replacementsImportPath, setReplacementsImportPath] = useState(config.replacementsImportPath || '');
  const [autoScanOverdueMinutes, setAutoScanOverdueMinutes] = useState(config.autoScanOverdueMinutes || 12);
  const [machineLastRunOverdueMinutes, setMachineLastRunOverdueMinutes] = useState(config.machineLastRunOverdueMinutes || 30);
  const [dataAccessUsername, setDataAccessUsername] = useState(config.dataAccessUsername || '');
  const [dataAccessPassword, setDataAccessPassword] = useState(config.dataAccessPassword || '');
  const [machineRows, setMachineRows] = useState(() =>
    config.machineIds.map((id) => ({ id, alias: config.machineAliases[id] || '', lastRunTxtPath: config.machineLastRunTxtPaths[id] || '' })),
  );
  const [excludedEventTerms, setExcludedEventTerms] = useState<string[]>(
    config.excludedEventTerms.length > 0 ? [...config.excludedEventTerms] : [''],
  );
  const [mlcTrendSettings, setMlcTrendSettings] = useState({ ...config.mlcTrendSettings });
  const [pageVisibility, setPageVisibility] = useState<Record<AppPageKey, boolean>>({
    ...DEFAULT_PAGE_VISIBILITY,
    ...config.pageVisibility,
  });
  const [customSubsystems, setCustomSubsystems] = useState<string[]>(
    config.subsystemConfig.customSubsystems.length > 0 ? [...config.subsystemConfig.customSubsystems] : [''],
  );
  const [otherLogAssignments, setOtherLogAssignments] = useState<LogTypeAssignmentRow[]>(
    config.subsystemConfig.otherLogTypeAssignments.map((assignment) => ({
      logType: assignment.logType,
      subsystem: assignment.subsystem,
      mode: assignment.mode,
    })),
  );

  const discoveredChartNames = useMemo(() => {
    const merged: Record<string, GenericEvent[]> = {};

    Object.values(eventData).forEach((machineEvents) => {
      Object.keys(machineEvents).forEach((type) => {
        merged[type] = [...(merged[type] || []), ...(machineEvents[type] || [])];
      });
    });

    return extractStatisticsSeries(merged).map((series) => series.key);
  }, [eventData]);
  const discoveredOtherLogTypes = useMemo(() => {
    const map = new Map<string, string>();
    Object.values(eventData).forEach((machineEvents) => {
      Object.values(machineEvents)
        .flat()
        .forEach((event) => {
          if (getSubsystemFromComponent(event.component) !== 'Other') return;
          const logType = String(event.logType || '').trim();
          if (!logType) return;
          if (!map.has(logType)) {
            map.set(logType, String(event.description || event.rawData?.fullMessage || ''));
          }
        });
    });
    return map;
  }, [eventData]);
  const availableOtherLogTypes = useMemo(
    () => [...new Set([...Array.from(discoveredOtherLogTypes.keys()), ...otherLogAssignments.map((item) => item.logType)])].sort(),
    [discoveredOtherLogTypes, otherLogAssignments],
  );

  useEffect(() => {
    setOtherLogAssignments((prev) => {
      const byLogType = new Map(prev.map((item) => [item.logType, item] as const));
      return availableOtherLogTypes.map((logType) => {
        const existing = byLogType.get(logType);
        return existing || { logType, subsystem: '', mode: 'data' as EventOperationalMode };
      });
    });
  }, [availableOtherLogTypes]);

  const unassignedOtherEventsByLogType = useMemo(() => {
    const counts = availableOtherLogTypes.reduce<Record<string, number>>((acc, logType) => ({ ...acc, [logType]: 0 }), {});
    const assignmentMap = new Map(otherLogAssignments.map((item) => [item.logType, item.subsystem.trim()] as const));

    Object.values(eventData).forEach((machineEvents) => {
      Object.values(machineEvents).flat().forEach((event) => {
        if (getSubsystemFromComponent(event.component) !== 'Other') return;
        const logType = String(event.logType || '').trim();
        if (!logType || !(logType in counts)) return;
        const assignedSubsystem = assignmentMap.get(logType) || '';
        if (!assignedSubsystem) counts[logType] += 1;
      });
    });

    return counts;
  }, [availableOtherLogTypes, eventData, otherLogAssignments]);

  const [chartSettings, setChartSettings] = useState<ChartSetting[]>(() => {
    const byName = new Map(config.chartSettings.map((setting) => [setting.eventName, setting]));
    const merged = [...new Set([...discoveredChartNames, ...byName.keys()])].sort((a, b) => a.localeCompare(b));
    return merged.map((eventName) => {
      const existing = byName.get(eventName);
      return {
        eventName,
        displayName: existing?.displayName || '',
        unit: existing?.unit || '',
        visible: existing?.visible !== false,
        limitMin: existing?.limitMin,
        limitMax: existing?.limitMax,
        setValue: existing?.setValue,
      };
    });
  });

  useEffect(() => {
    setChartSettings((prev) => {
      const byName = new Map(prev.map((item) => [item.eventName, item] as const));
      const mergedNames = [...new Set([...discoveredChartNames, ...byName.keys()])].sort((a, b) => a.localeCompare(b));
      return mergedNames.map((eventName) => ({
        eventName,
        displayName: byName.get(eventName)?.displayName || '',
        unit: byName.get(eventName)?.unit || '',
        visible: byName.get(eventName)?.visible !== false,
        limitMin: byName.get(eventName)?.limitMin,
        limitMax: byName.get(eventName)?.limitMax,
        setValue: byName.get(eventName)?.setValue,
      }));
    });
  }, [discoveredChartNames]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const cleanedChartSettings = () =>
    chartSettings
      .map((setting) => ({
        eventName: setting.eventName.trim(),
        displayName: (setting.displayName || '').trim() || undefined,
        unit: (setting.unit || '').trim() || undefined,
        visible: setting.visible !== false,
        limitMin: Number.isFinite(setting.limitMin) ? Number(setting.limitMin) : undefined,
        limitMax: Number.isFinite(setting.limitMax) ? Number(setting.limitMax) : undefined,
        setValue: Number.isFinite(setting.setValue) ? Number(setting.setValue) : undefined,
      }))
      .filter((setting) => setting.eventName.length > 0);

  const cleanedExcludedTerms = excludedEventTerms.map((item) => item.trim()).filter((item) => item.length > 0);
  const cleanedCustomSubsystems = customSubsystems.map((item) => item.trim()).filter((item) => item.length > 0);
  const subsystemOptions = [...DEFAULT_SUBSYSTEMS, ...cleanedCustomSubsystems];
  const cleanedOtherAssignments = otherLogAssignments
    .map((item) => ({
      logType: item.logType.trim(),
      subsystem: item.subsystem.trim(),
      mode: item.mode,
    }))
    .filter((item) => item.logType.length > 0 && item.subsystem.length > 0);

  const getMachinePayload = () => {
    const cleaned = machineRows
      .map((machine) => ({ id: machine.id.trim(), alias: machine.alias.trim() }))
      .filter((machine) => machine.id.length > 0);

    const machineIds = cleaned.map((machine) => machine.id);
    const machineAliases = cleaned.reduce<Record<string, string>>((acc, machine) => {
      if (machine.alias) {
        acc[machine.id] = machine.alias;
      }
      return acc;
    }, {});

    return { machineIds, machineAliases };
  };

  const handleSave = async () => {
    const { machineIds, machineAliases } = getMachinePayload();
    if (machineIds.length === 0) {
      toast.error('At least one machine ID is required');
      return;
    }

    updateConfig({
      hospitalName: hospitalName.trim(),
      machineIds,
      machineAliases,
      desktopConfigPath: desktopConfigPath.trim(),
      machineLastRunTxtPaths: machineIds.reduce<Record<string, string>>((acc, machineId) => {
        const row = machineRows.find((item) => item.id.trim() === machineId);
        const path = row?.lastRunTxtPath?.trim() || '';
        if (path) acc[machineId] = path;
        return acc;
      }, {}),
      databaseDirectory: databaseDirectory.trim(),
      replacementsImportPath: replacementsImportPath.trim(),
      autoScanOverdueMinutes: Math.max(1, Math.round(autoScanOverdueMinutes)),
      machineLastRunOverdueMinutes: Math.max(1, Math.round(machineLastRunOverdueMinutes)),
      dataAccessUsername: dataAccessUsername.trim(),
      dataAccessPassword: dataAccessPassword.trim(),
      excludedEventTerms: cleanedExcludedTerms,
      chartSettings: cleanedChartSettings(),
      mlcTrendSettings: normalizeMlcSettings(mlcTrendSettings),
      pageVisibility,
      subsystemConfig: {
        customSubsystems: cleanedCustomSubsystems,
        otherLogTypeAssignments: cleanedOtherAssignments,
      },
    });

    setMachineRows(
      machineIds.map((id) => ({
        id,
        alias: machineAliases[id] || '',
        lastRunTxtPath: machineRows.find((item) => item.id.trim() === id)?.lastRunTxtPath?.trim() || '',
      })),
    );
    setMlcTrendSettings(normalizeMlcSettings(mlcTrendSettings));

    const saveLocations = await getConfigSaveLocations();
    if (saveLocations.length > 0) {
      toast.success('Configuration saved.', {
        description: `Saved to:
${saveLocations.join('\n')}\nReload the page to apply machine changes.`,
      });
      return;
    }

    toast.success('Configuration saved in browser local storage (key: ethos_config.json). Reload the page to apply machine changes.');
  };

  const addMachine = () => setMachineRows((prev) => [...prev, { id: '', alias: '', lastRunTxtPath: '' }]);
  const removeMachine = (index: number) => setMachineRows((prev) => prev.filter((_, i) => i !== index));
  const updateMachine = (index: number, key: 'id' | 'alias' | 'lastRunTxtPath', value: string) => {
    setMachineRows((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  };

  const addExcludedTerm = () => setExcludedEventTerms((prev) => [...prev, '']);
  const updateExcludedTerm = (index: number, value: string) =>
    setExcludedEventTerms((prev) => prev.map((item, i) => (i === index ? value : item)));
  const removeExcludedTerm = (index: number) => setExcludedEventTerms((prev) => prev.filter((_, i) => i !== index));
  const addCustomSubsystem = () => setCustomSubsystems((prev) => [...prev, '']);
  const updateCustomSubsystem = (index: number, value: string) =>
    setCustomSubsystems((prev) => prev.map((item, i) => (i === index ? value : item)));
  const removeCustomSubsystem = (index: number) => setCustomSubsystems((prev) => prev.filter((_, i) => i !== index));
  const updateOtherAssignment = (logType: string, key: 'subsystem' | 'mode', value: string) => {
    setOtherLogAssignments((prev) => prev.map((row) => (row.logType === logType ? { ...row, [key]: value } : row)));
  };

  const updateChartSetting = (
    eventName: string,
    key: 'displayName' | 'unit' | 'visible' | 'limitMin' | 'limitMax' | 'setValue',
    value: string | boolean | number | undefined,
  ) => {
    setChartSettings((prev) =>
      prev.map((setting) => {
        if (setting.eventName !== eventName) return setting;
        return { ...setting, [key]: value };
      }),
    );
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await importConfig(file);
      const stored = localStorage.getItem('ethos-dashboard-config');
      if (stored) {
        const parsed = JSON.parse(stored);
        const importedMachineIds = Array.isArray(parsed.machineIds) ? parsed.machineIds : [];
        const importedAliases = parsed.machineAliases || {};

        setHospitalName(parsed.hospitalName || '');
        setDesktopConfigPath(parsed.desktopConfigPath || '');
        setDatabaseDirectory(parsed.databaseDirectory || '');
        setReplacementsImportPath(parsed.replacementsImportPath || '');
        setAutoScanOverdueMinutes(Number(parsed.autoScanOverdueMinutes || 12));
        setMachineLastRunOverdueMinutes(Number(parsed.machineLastRunOverdueMinutes || 30));
        setDataAccessUsername(parsed.dataAccessUsername || '');
        setDataAccessPassword(parsed.dataAccessPassword || '');
        const importedLastRunPaths = parsed.machineLastRunTxtPaths || {};
        setMachineRows(
          importedMachineIds.map((id: string) => ({
            id,
            alias: importedAliases[id] || '',
            lastRunTxtPath: importedLastRunPaths[id] || '',
          })),
        );
        setExcludedEventTerms(Array.isArray(parsed.excludedEventTerms) ? parsed.excludedEventTerms : ['']);
        setMlcTrendSettings(normalizeMlcSettings(parsed?.mlcTrendSettings || MLC_DEFAULTS));
        setPageVisibility({
          ...DEFAULT_PAGE_VISIBILITY,
          ...(parsed?.pageVisibility || {}),
        });
        const parsedCustomSubsystems = Array.isArray(parsed?.subsystemConfig?.customSubsystems)
          ? parsed.subsystemConfig.customSubsystems
          : [''];
        setCustomSubsystems(parsedCustomSubsystems.length > 0 ? parsedCustomSubsystems : ['']);
        const parsedAssignments = Array.isArray(parsed?.subsystemConfig?.otherLogTypeAssignments)
          ? parsed.subsystemConfig.otherLogTypeAssignments
          : [];
        setOtherLogAssignments(
          parsedAssignments.map((item: { logType?: string; subsystem?: string; mode?: string }) => ({
            logType: String(item?.logType || ''),
            subsystem: String(item?.subsystem || ''),
            mode: (item?.mode || 'data') as EventOperationalMode,
          })),
        );

        const importedSettings = Array.isArray(parsed.chartSettings) ? parsed.chartSettings : [];
        const mergedNames = [...new Set([...discoveredChartNames, ...importedSettings.map((item: ChartSetting) => item.eventName)])].sort((a, b) => a.localeCompare(b));
        setChartSettings(
          mergedNames.map((eventName) => {
            const found = importedSettings.find((item: ChartSetting) => item.eventName === eventName);
            return {
              eventName,
              displayName: found?.displayName || '',
              unit: found?.unit || '',
              visible: found?.visible !== false,
              limitMin: Number.isFinite(found?.limitMin) ? Number(found?.limitMin) : undefined,
              limitMax: Number.isFinite(found?.limitMax) ? Number(found?.limitMax) : undefined,
              setValue: Number.isFinite(found?.setValue) ? Number(found?.setValue) : undefined,
            };
          }),
        );
      }
      toast.success('Configuration imported. Reload the page to apply machine changes.');
    } catch {
      toast.error('Failed to import configuration file');
    }

    e.target.value = '';
  };

  const persistedMachineRows = config.machineIds.map((id) => ({
    id,
    alias: config.machineAliases[id] || '',
    lastRunTxtPath: config.machineLastRunTxtPaths[id] || '',
  }));
  const hasChanges =
    hospitalName !== config.hospitalName ||
    desktopConfigPath.trim() !== (config.desktopConfigPath || '') ||
    databaseDirectory.trim() !== (config.databaseDirectory || '') ||
    replacementsImportPath.trim() !== (config.replacementsImportPath || '') ||
    Math.max(1, Math.round(autoScanOverdueMinutes)) !== config.autoScanOverdueMinutes ||
    Math.max(1, Math.round(machineLastRunOverdueMinutes)) !== config.machineLastRunOverdueMinutes ||
    dataAccessUsername.trim() !== (config.dataAccessUsername || '') ||
    dataAccessPassword.trim() !== (config.dataAccessPassword || '') ||
    JSON.stringify(
      machineRows
        .map((item) => ({ id: item.id.trim(), alias: item.alias.trim(), lastRunTxtPath: item.lastRunTxtPath.trim() }))
        .filter((item) => item.id),
    ) !==
      JSON.stringify(persistedMachineRows) ||
    JSON.stringify(cleanedExcludedTerms) !== JSON.stringify(config.excludedEventTerms) ||
    JSON.stringify(cleanedChartSettings()) !== JSON.stringify(config.chartSettings) ||
    JSON.stringify(normalizeMlcSettings(mlcTrendSettings)) !== JSON.stringify(config.mlcTrendSettings) ||
    JSON.stringify(pageVisibility) !== JSON.stringify(config.pageVisibility) ||
    JSON.stringify(cleanedCustomSubsystems) !== JSON.stringify(config.subsystemConfig.customSubsystems) ||
    JSON.stringify(cleanedOtherAssignments) !== JSON.stringify(config.subsystemConfig.otherLogTypeAssignments);

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Configuration</h2>
        <p className="text-sm text-muted-foreground mt-1">Configure dashboard behavior, access control, machine metadata and MLC analysis settings.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">General Settings</CardTitle>
          <CardDescription>Dashboard-wide filters and chart display settings are saved in the general configuration file.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs defaultValue="general" className="space-y-4">
            <TabsList className="flex flex-wrap h-auto">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="machine-ids">Machines</TabsTrigger>
              <TabsTrigger value="paths-access">Paths & Access</TabsTrigger>
              <TabsTrigger value="event-filters">Event Filters</TabsTrigger>
              <TabsTrigger value="chart-settings">Chart Settings</TabsTrigger>
              <TabsTrigger value="mlc-analysis">MLC Analysis</TabsTrigger>
              <TabsTrigger value="subsystems">Subsystems</TabsTrigger>
              <TabsTrigger value="navigation">Navigation</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Appearance</Label>
                  <p className="text-sm text-muted-foreground">Switch between light and dark mode</p>
                </div>
                <div className="flex items-center gap-2">
                  <Sun className="h-4 w-4 text-muted-foreground" />
                  <Switch checked={theme === 'dark'} onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')} />
                  <Moon className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="hospitalName">Hospital Name</Label>
                <Input id="hospitalName" value={hospitalName} onChange={(e) => setHospitalName(e.target.value)} placeholder="e.g. Radboudumc" />
              </div>
            </TabsContent>

            <TabsContent value="machine-ids" className="space-y-4">
              <p className="text-sm text-muted-foreground">Configure machine IDs and optional aliases shown in headers and the sidebar.</p>
              <div className="space-y-2">
                {machineRows.map((machine, index) => (
                  <div key={index} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-center">
                    <Input
                      value={machine.id}
                      onChange={(e) => updateMachine(index, 'id', e.target.value)}
                      placeholder="e.g. HAL2106"
                      className="font-mono"
                    />
                    <Input
                      value={machine.alias}
                      onChange={(e) => updateMachine(index, 'alias', e.target.value)}
                      placeholder="Alias (optional), e.g. LINAC 1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeMachine(index)}
                      disabled={machineRows.length <= 1}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={addMachine} className="gap-2">
                <Plus className="h-4 w-4" />
                Add Machine
              </Button>
            </TabsContent>

            <TabsContent value="paths-access" className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="desktopConfigPath">Ethos config file path (optional explicit file path)</Label>
                <Input
                  id="desktopConfigPath"
                  value={desktopConfigPath}
                  onChange={(e) => setDesktopConfigPath(e.target.value)}
                  placeholder="\\server\share\ethos\ethos_config.json"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Optional explicit path. Auto-import checks only: executable directory (recursive), DEFAULT_UNC_CONFIG_PATH, and this path.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="databaseDirectory">Database / log directory (auto-scan on desktop startup)</Label>
                <Input
                  id="databaseDirectory"
                  value={databaseDirectory}
                  onChange={(e) => setDatabaseDirectory(e.target.value)}
                  placeholder="C:\\path\\to\\ethos\\database"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Optional health marker: if <span className="font-mono">last_runCombinedprocessor.txt</span> exists here with
                  <span className="font-mono"> Last run: YYYY-MM-DD HH:mm:ss</span>, it is used for stale-status monitoring.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="replacementsImportPath">Replacements Excel path (UNC/network path supported)</Label>
                <Input
                  id="replacementsImportPath"
                  value={replacementsImportPath}
                  onChange={(e) => setReplacementsImportPath(e.target.value)}
                  placeholder="\\server\share\MotorReplacements.xlsx"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  On desktop startup the app imports this file automatically and refreshes it every 5 minutes.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="autoScanOverdueMinutes">Desktop auto-scan overdue threshold (minutes)</Label>
                  <Input
                    id="autoScanOverdueMinutes"
                    type="number"
                    min={1}
                    value={autoScanOverdueMinutes}
                    onChange={(e) => setAutoScanOverdueMinutes(Number(e.target.value) || 1)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="machineLastRunOverdueMinutes">Machine last-run overdue threshold (minutes)</Label>
                  <Input
                    id="machineLastRunOverdueMinutes"
                    type="number"
                    min={1}
                    value={machineLastRunOverdueMinutes}
                    onChange={(e) => setMachineLastRunOverdueMinutes(Number(e.target.value) || 1)}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label>Machine-specific last-run TXT paths</Label>
                <p className="text-xs text-muted-foreground">
                  Per machine, set the path to the TXT file that contains a line like: Last run: 2026-03-26 14:29:18
                </p>
                <div className="space-y-2">
                  {machineRows.map((machine, index) => (
                    <div key={`last-run-${index}`} className="grid grid-cols-1 md:grid-cols-[180px_minmax(0,1fr)] gap-2 items-center">
                      <Label className="font-mono text-xs">{machine.id || `Machine ${index + 1}`}</Label>
                      <Input
                        value={machine.lastRunTxtPath}
                        onChange={(e) => updateMachine(index, 'lastRunTxtPath', e.target.value)}
                        placeholder="\\server\\share\ethos\HAL2106\last_run10min.txt"
                        className="font-mono"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label>Data section access (optional)</Label>
                <p className="text-xs text-muted-foreground">
                  If both username and password are set, pages in the Data section require login. Leave either field empty to keep them open.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="dataAccessUsername">Data username</Label>
                    <Input
                      id="dataAccessUsername"
                      value={dataAccessUsername}
                      onChange={(e) => setDataAccessUsername(e.target.value)}
                      placeholder="optional"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dataAccessPassword">Data password</Label>
                    <Input
                      id="dataAccessPassword"
                      type="password"
                      value={dataAccessPassword}
                      onChange={(e) => setDataAccessPassword(e.target.value)}
                      placeholder="optional"
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="event-filters" className="space-y-3">
              <p className="text-sm text-muted-foreground">Events containing these terms are automatically filtered out across the dashboard.</p>
              {excludedEventTerms.map((term, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={term}
                    onChange={(e) => updateExcludedTerm(index, e.target.value)}
                    placeholder="e.g. heartbeat, ack, CoolingcityWaterTempStatistics"
                    className="font-mono"
                  />
                  <Button variant="ghost" size="icon" onClick={() => removeExcludedTerm(index)} className="shrink-0 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addExcludedTerm} className="gap-2">
                <Plus className="h-4 w-4" />
                Add Excluded Term
              </Button>
            </TabsContent>

            <TabsContent value="chart-settings" className="space-y-3">
              <p className="text-sm text-muted-foreground">Configure how each statistics chart is displayed.</p>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left p-3">Chart event name</th>
                      <th className="text-left p-3">Display name</th>
                      <th className="text-left p-3">Unit of measure</th>
                      <th className="text-left p-3">Default min</th>
                      <th className="text-left p-3">Default max</th>
                      <th className="text-left p-3">Set value</th>
                      <th className="text-left p-3">Visible</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartSettings.map((setting) => (
                      <tr key={setting.eventName} className="border-b">
                        <td className="p-3 font-mono text-xs">{setting.eventName}</td>
                        <td className="p-3">
                          <Input value={setting.displayName || ''} onChange={(e) => updateChartSetting(setting.eventName, 'displayName', e.target.value)} placeholder={setting.eventName} />
                        </td>
                        <td className="p-3">
                          <Input value={setting.unit || ''} onChange={(e) => updateChartSetting(setting.eventName, 'unit', e.target.value)} placeholder="kPa / PSI / °C" className="max-w-[160px]" />
                        </td>
                        <td className="p-3">
                          <Input
                            type="number"
                            value={setting.limitMin ?? ''}
                            onChange={(e) =>
                              updateChartSetting(
                                setting.eventName,
                                'limitMin',
                                e.target.value === '' ? undefined : Number(e.target.value),
                              )
                            }
                            placeholder="optional"
                            className="max-w-[130px]"
                          />
                        </td>
                        <td className="p-3">
                          <Input
                            type="number"
                            value={setting.limitMax ?? ''}
                            onChange={(e) =>
                              updateChartSetting(
                                setting.eventName,
                                'limitMax',
                                e.target.value === '' ? undefined : Number(e.target.value),
                              )
                            }
                            placeholder="optional"
                            className="max-w-[130px]"
                          />
                        </td>
                        <td className="p-3">
                          <Input
                            type="number"
                            value={setting.setValue ?? ''}
                            onChange={(e) =>
                              updateChartSetting(
                                setting.eventName,
                                'setValue',
                                e.target.value === '' ? undefined : Number(e.target.value),
                              )
                            }
                            placeholder="optional"
                            className="max-w-[130px]"
                          />
                        </td>
                        <td className="p-3">
                          <Checkbox checked={setting.visible !== false} onCheckedChange={(value) => updateChartSetting(setting.eventName, 'visible', Boolean(value))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="mlc-analysis" className="space-y-4">
              <p className="text-sm text-muted-foreground">Configure MLC trend detection thresholds. Empty/invalid values automatically fall back to defaults.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="minIncidentDaysForTrend" className="flex items-center gap-2">
                    Min incident days for trend visibility
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <CircleHelp className="h-4 w-4 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Controls when a motor starts showing a trend badge in the MLC views.</p>
                        <p>Only motors with incident-days ≥ this value are evaluated.</p>
                        <p>Default: 4 days • Typical range: 2-10 • Increment: 1 day</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Input
                    id="minIncidentDaysForTrend"
                    type="number"
                    min={2}
                    step={1}
                    value={mlcTrendSettings.minIncidentDaysForTrend}
                    onChange={(e) => setMlcTrendSettings((prev) => ({ ...prev, minIncidentDaysForTrend: Number(e.target.value) }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="minIncidentDaysForDirection" className="flex items-center gap-2">
                    Min incident days for up/down direction
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <CircleHelp className="h-4 w-4 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Controls when trend direction is allowed to show Up or Down (instead of Stable/Not enough data).</p>
                        <p>Must be equal to or higher than the trend visibility threshold.</p>
                        <p>Default: 6 days • Typical range: 4-14 • Increment: 1 day</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Input
                    id="minIncidentDaysForDirection"
                    type="number"
                    min={2}
                    step={1}
                    value={mlcTrendSettings.minIncidentDaysForDirection}
                    onChange={(e) => setMlcTrendSettings((prev) => ({ ...prev, minIncidentDaysForDirection: Number(e.target.value) }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rateDiffThreshold" className="flex items-center gap-2">
                    Rate stability threshold
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <CircleHelp className="h-4 w-4 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Defines sensitivity for incident-rate change (recent vs historical).</p>
                        <p>Lower value = more sensitive trend changes; higher value = more stable output.</p>
                        <p>Default: 0.12 • Typical range: 0.05-0.25 • Increment: 0.01</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Input
                    id="rateDiffThreshold"
                    type="number"
                    min={0}
                    step={0.01}
                    value={mlcTrendSettings.rateDiffThreshold}
                    onChange={(e) => setMlcTrendSettings((prev) => ({ ...prev, rateDiffThreshold: Number(e.target.value) }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="intervalDiffThresholdDays" className="flex items-center gap-2">
                    Inter-arrival stability threshold (days)
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <CircleHelp className="h-4 w-4 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Defines acceptable variation in days-between-incidents before a motor is considered unstable.</p>
                        <p>Lower value = stricter stability check; higher value = more tolerant.</p>
                        <p>Default: 3 days • Typical range: 1-7 • Increment: 0.5 day</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Input
                    id="intervalDiffThresholdDays"
                    type="number"
                    min={0}
                    step={0.5}
                    value={mlcTrendSettings.intervalDiffThresholdDays}
                    onChange={(e) => setMlcTrendSettings((prev) => ({ ...prev, intervalDiffThresholdDays: Number(e.target.value) }))}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="subsystems" className="space-y-5">
              <div className="space-y-3">
                <Label>Custom subsystems</Label>
                <p className="text-xs text-muted-foreground">
                  The default subsystems (Supervisor, Beam, Collimator, Couch, Stand, XI Imaging) stay fixed and cannot be removed.
                </p>
                {customSubsystems.map((name, index) => (
                  <div key={`custom-subsystem-${index}`} className="flex items-center gap-2">
                    <Input
                      value={name}
                      onChange={(e) => updateCustomSubsystem(index, e.target.value)}
                      placeholder="e.g. OIS Integration"
                    />
                    <Button variant="ghost" size="icon" onClick={() => removeCustomSubsystem(index)} className="shrink-0 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addCustomSubsystem} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Add Subsystem
                </Button>
              </div>

              <div className="space-y-3">
                <Label>Assign &quot;component: Other&quot; events by logType</Label>
                <p className="text-xs text-muted-foreground">
                  Set the destination subsystem and default mode classification (Data/Service/Clinical) for each logType.
                </p>
                <div className="space-y-2">
                  {otherLogAssignments.length === 0 && (
                    <p className="text-xs text-muted-foreground">No `component: Other` logTypes discovered yet.</p>
                  )}
                  {otherLogAssignments.map((row) => (
                    <div key={`assignment-${row.logType}`} className="grid grid-cols-1 md:grid-cols-[250px_minmax(0,1fr)_150px] gap-2 items-center rounded-md border px-3 py-2">
                      <Label className="font-mono" title={discoveredOtherLogTypes.get(row.logType) || ''}>{row.logType}</Label>
                      <Input
                        list="subsystem-options"
                        value={row.subsystem}
                        onChange={(e) => updateOtherAssignment(row.logType, 'subsystem', e.target.value)}
                        placeholder="Select or type subsystem"
                      />
                      <select
                        value={row.mode}
                        onChange={(e) => updateOtherAssignment(row.logType, 'mode', e.target.value)}
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="data">Data logs</option>
                        <option value="service">Service mode</option>
                        <option value="clinical">Clinical mode</option>
                      </select>
                    </div>
                  ))}
                  <datalist id="subsystem-options">
                    {subsystemOptions.map((name) => (
                      <option key={`subsystem-option-${name}`} value={name} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="space-y-3">
                <Label>Unassigned &quot;Other&quot; events by logType</Label>
                <p className="text-xs text-muted-foreground">
                  These are currently not mapped to any subsystem yet and can be assigned above.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {availableOtherLogTypes.length === 0 && (
                    <p className="text-xs text-muted-foreground col-span-full">No `component: Other` logTypes found in loaded data.</p>
                  )}
                  {availableOtherLogTypes.map((logType) => (
                    <div key={`unassigned-${logType}`} className="rounded-md border px-3 py-2">
                      <div className="text-xs font-mono text-muted-foreground">{logType}</div>
                      <div className="text-lg font-semibold">{unassignedOtherEventsByLogType[logType] || 0}</div>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="navigation" className="space-y-5">
              <div className="space-y-3">
                <Label>Page visibility</Label>
                <p className="text-xs text-muted-foreground">
                  Toggle which pages are visible in the sidebar and accessible by route.
                </p>
                <div className="space-y-2">
                  {APP_PAGES.map((page) => (
                    <div key={page.key} className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">{page.title}</p>
                        <p className="text-xs text-muted-foreground font-mono">{page.path}</p>
                      </div>
                      <Switch
                        checked={pageVisibility[page.key] !== false}
                        disabled={!page.hideable}
                        onCheckedChange={(checked) =>
                          setPageVisibility((prev) => ({
                            ...prev,
                            [page.key]: page.hideable ? checked : true,
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} className="gap-2" disabled={!hasChanges}>
              <Save className="h-4 w-4" />
              Save Configuration
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Import / Export</CardTitle>
          <CardDescription>Share general configuration between dashboard instances.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button variant="outline" size="sm" onClick={exportConfig} className="gap-2">
            <Download className="h-4 w-4" />
            Export Config
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="gap-2">
            <Upload className="h-4 w-4" />
            Import Config
          </Button>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
        </CardContent>
      </Card>
    </div>
  );
};

export default ConfigurationPage;
