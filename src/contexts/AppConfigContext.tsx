import { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from 'react';
import { DEFAULT_MACHINE_IDS } from '@/data/mlcErrorData';
import { isTauriRuntime, tauriFs, tauriPath, type TauriDirEntry } from '@/lib/tauriBridge';
import { APP_PAGES, DEFAULT_PAGE_VISIBILITY, type AppPageKey } from '@/lib/pageRegistry';
import { type FilterAction, type ResolutionStrategy, type Rule, parseProcessorConfig } from '@/lib/filterPolicyV2';
import { type SubsystemConfig, type EventOperationalMode } from '@/data/componentSubsystems';

const CONFIG_STORAGE_KEY = 'ethos_config.json';
const PROCESSOR_CONFIG_STORAGE_KEY = 'config.json';
const DESKTOP_CONFIG_FILENAME = 'ethos_config.json';
// Optional hardcoded UNC path override. Example: '\\\\server\\share\\ethos\\ethos_config.json: '';'
// Leave empty to disable this lookup.
const DEFAULT_UNC_CONFIG_PATH = '\\\\server\\share\\ethos\\ethos_config.json';

export interface ChartSetting {
  eventName: string;
  displayName?: string;
  unit?: string;
  visible: boolean;
  limitMin?: number;
  limitMax?: number;
  setValue?: number;
}

export interface MlcTrendSettings {
  minIncidentDaysForTrend: number;
  minIncidentDaysForDirection: number;
  rateDiffThreshold: number;
  intervalDiffThresholdDays: number;
}

export interface AppConfig {
  hospitalName: string;
  machineIds: string[];
  machineAliases: Record<string, string>;
  desktopConfigPath: string;
  machineLastRunTxtPaths: Record<string, string>;
  databaseDirectory: string;
  replacementsImportPath: string;
  autoScanOverdueMinutes: number;
  machineLastRunOverdueMinutes: number;
  dataAccessUsername: string;
  dataAccessPassword: string;
  excludedEventTerms: string[];
  chartSettings: ChartSetting[];
  mlcTrendSettings: MlcTrendSettings;
  pageVisibility: Record<AppPageKey, boolean>;
  subsystemConfig: SubsystemConfig;
}

export interface ProcessorFilter {
  columnIndex: number;
  includeAny?: string[];
  exclude?: string[];
}

export interface ProcessorConditionalRule {
  if: ProcessorFilter;
  then: ProcessorFilter[];
}

export interface CombinedLogProcessorConfig {
  inputs: string[];
  archiveDir: string;
  outputDir: string;
  machineIds: string[];
  excludeFiles: string[];
  lastRunFile: string;
  parserMode?: 'auto' | 'thread' | 'process';
  parserWorkers?: number;
  parseBatchSize?: number;
  profilePerFile?: boolean;
  filters?: ProcessorFilter[];
  conditionalFilters?: ProcessorConditionalRule[];
  filterPolicyVersion?: 2;
  defaultAction?: FilterAction;
  resolutionStrategy?: ResolutionStrategy;
  rules?: Rule[];
  [key: string]: unknown;
}

const DEFAULT_CONFIG: AppConfig = {
  hospitalName: 'Radboudumc',
  machineIds: [...DEFAULT_MACHINE_IDS],
  machineAliases: {},
  desktopConfigPath: 'C:\\Users\\z169155\\AppData\\Local\\Ethos-Dashboard\\ethos_config.json',
  machineLastRunTxtPaths: {},
  databaseDirectory: '',
  replacementsImportPath: '',
  autoScanOverdueMinutes: 12,
  machineLastRunOverdueMinutes: 30,
  dataAccessUsername: '',
  dataAccessPassword: '',
  excludedEventTerms: [],
  chartSettings: [],
  mlcTrendSettings: {
    minIncidentDaysForTrend: 4,
    minIncidentDaysForDirection: 6,
    rateDiffThreshold: 0.12,
    intervalDiffThresholdDays: 3,
  },
  pageVisibility: { ...DEFAULT_PAGE_VISIBILITY },
  subsystemConfig: {
    customSubsystems: [],
    otherLogTypeAssignments: [],
  },
};

const parsePageVisibility = (value: unknown): Record<AppPageKey, boolean> => {
  const raw = (value ?? {}) as Record<string, unknown>;
  return APP_PAGES.reduce(
    (acc, page) => ({ ...acc, [page.key]: page.hideable ? raw[page.key] !== false : true }),
    { ...DEFAULT_PAGE_VISIBILITY } as Record<AppPageKey, boolean>,
  );
};

type TauriApi = {
  fs?: {
    readTextFile?: (path: string) => Promise<string>;
    writeTextFile?: (arg: { path: string; contents: string } | string, contents?: string) => Promise<void>;
  };
  path?: {
    join?: (...parts: string[]) => Promise<string>;
    dirname?: (path: string) => Promise<string>;
    executableDir?: () => Promise<string>;
    appConfigDir?: () => Promise<string>;
    appDataDir?: () => Promise<string>;
    desktopDir?: () => Promise<string>;
  };
};

/**
 * Reads low-level Tauri APIs from the global runtime object.
 *
 * @returns Tauri API surface when available; otherwise `null`.
 */
const getTauriApi = (): TauriApi | null => {
  const runtime = window as unknown as { __TAURI__?: TauriApi };
  return runtime.__TAURI__ ?? null;
};

interface AppConfigContextType {
  config: AppConfig;
  processorConfig: CombinedLogProcessorConfig;
  getMachineLabel: (machineId: string) => string;
  updateConfig: (config: AppConfig) => void;
  updateProcessorConfig: (config: CombinedLogProcessorConfig) => void;
  exportConfig: () => void;
  importConfig: (file: File) => Promise<void>;
  exportProcessorConfig: () => void;
  importProcessorConfig: (file: File) => Promise<void>;
  importDesktopConfigFromDefaults: (options?: { applyConfig?: boolean; verbose?: boolean }) => Promise<{
    attempts: Array<{ path: string; status: 'success' | 'failed'; detail: string }>;
    loadedPath?: string;
    error?: string;
  }>;
}

const AppConfigContext = createContext<AppConfigContextType | null>(null);

const DEFAULT_PROCESSOR_CONFIG: CombinedLogProcessorConfig = {
  inputs: ['C:\\Users\\Z10000\\Varian_CombinedLog_Processor\\dist'],
  archiveDir: 'C:\\Users\\Z10000\\Varian_CombinedLog_Processor\\dist',
  outputDir: 'C:\\Users\\Z10000\\Varian_CombinedLog_Processor\\dist',
  machineIds: ['HAL2106', 'HAL2403', 'HAL2533'],
  excludeFiles: ['last_run10Min.txt', 'last_runDaily.txt'],
  lastRunFile: '',
  parserMode: 'auto',
  parserWorkers: 1,
  parseBatchSize: 1,
  profilePerFile: false,
  filters: [
    { columnIndex: 6, includeAny: ['COL', 'STN', 'SPV', 'BGM', 'CCHU', 'XI'] },
    { columnIndex: 7, includeAny: ['Controller', 'Fault'] },
    {
      columnIndex: 8,
      includeAny: [
        'raise',
        'heartbeat ',
        'assert',
        'CoolingpumpHighStatistics',
        'sf6GasPressure',
        'CoolingWaterTankTempStatistics',
        'CoolingcityWaterTempStatistics',
        'CoolingtargetFlowLowStatistics',
        'CoolingmagnetronFlowLowStatistics',
      ],
    },
    { columnIndex: 0, exclude: ['1970', '1969'] },
    { columnIndex: 5, exclude: ['HAL-CR*', 'HAL_TRT*', 'webservicehost'] },
    { columnIndex: 6, exclude: ['CR', 'OSM.AppEvents'] },
    { columnIndex: 7, exclude: ['Coordinator', 'HardwareAPI', 'Interlock', 'General'] },
    { columnIndex: 8, exclude: ['ack', 'Warning', 'release', '1003', '1004', '1005', '1013', '2006', 'Prepare'] },
  ],
  conditionalFilters: [],
};

/**
 * Parses one processor filter entry.
 *
 * @param filter Candidate filter.
 * @returns Cleaned filter or null when invalid.
 */
const parseProcessorFilter = (filter: unknown): ProcessorFilter | null => {
  const obj = filter as Partial<ProcessorFilter>;
  const columnIndex = Number(obj?.columnIndex);
  const includeAny = cleanStringArray(obj?.includeAny);
  const exclude = cleanStringArray(obj?.exclude);
  if (!Number.isInteger(columnIndex) || (includeAny.length === 0 && exclude.length === 0)) {
    return null;
  }

  const cleanedFilter: ProcessorFilter = { columnIndex };
  if (includeAny.length > 0) cleanedFilter.includeAny = includeAny;
  if (exclude.length > 0) cleanedFilter.exclude = exclude;
  return cleanedFilter;
};

/**
 * Parses conditional processor rules.
 *
 * @param value Candidate persisted value.
 * @returns Validated conditional rules.
 */
const parseConditionalRules = (value: unknown): ProcessorConditionalRule[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((rule: unknown) => {
      const obj = rule as { if?: unknown; then?: unknown };
      const ifRule = parseProcessorFilter(obj.if);
      const thenRules = Array.isArray(obj.then) ? obj.then.map(parseProcessorFilter).filter((item): item is ProcessorFilter => item !== null) : [];
      if (!ifRule || thenRules.length === 0) return null;
      return { if: ifRule, then: thenRules };
    })
    .filter((item): item is ProcessorConditionalRule => item !== null);
};

/**
 * Normalizes unknown input into a trimmed string array.
 *
 * @param value Candidate value.
 * @returns Cleaned array of non-empty strings.
 */
const cleanStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter((item) => item.length > 0)
    : [];

/**
 * Parses chart setting objects from persisted config data.
 *
 * @param value Candidate persisted value.
 * @returns Validated chart settings.
 */
const parseChartSettings = (value: unknown): ChartSetting[] => {
  if (!Array.isArray(value)) return [];

  const parseOptionalNumber = (input: unknown): number | undefined => {
    if (input === null || input === undefined || input === '') return undefined;
    const parsed = Number(input);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  return value
    .map((item) => {
      const record = item as Partial<ChartSetting>;
      const eventName = String(record.eventName || '').trim();
      if (!eventName) return null;
      const displayName = String(record.displayName || '').trim();
      const unit = String(record.unit || '').trim();
      const limitMin = parseOptionalNumber(record.limitMin);
      const limitMax = parseOptionalNumber(record.limitMax);
      const setValue = parseOptionalNumber(record.setValue);
      return {
        eventName,
        displayName: displayName || undefined,
        unit: unit || undefined,
        visible: record.visible !== false,
        limitMin,
        limitMax,
        setValue,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null) as ChartSetting[];
};

/**
 * Parses trend settings from persisted config data with safe bounds.
 *
 * @param value Candidate persisted value.
 * @returns Validated trend settings.
 */
const parseMlcTrendSettings = (value: unknown): MlcTrendSettings => {
  const defaults = DEFAULT_CONFIG.mlcTrendSettings;
  const record = (value ?? {}) as Partial<MlcTrendSettings>;
  const minIncidentDaysForTrend = Math.max(2, Math.round(Number(record.minIncidentDaysForTrend ?? defaults.minIncidentDaysForTrend)));
  const minIncidentDaysForDirection = Math.max(
    minIncidentDaysForTrend,
    Math.round(Number(record.minIncidentDaysForDirection ?? defaults.minIncidentDaysForDirection)),
  );

  const rateDiffThreshold = Number(record.rateDiffThreshold ?? defaults.rateDiffThreshold);
  const intervalDiffThresholdDays = Number(record.intervalDiffThresholdDays ?? defaults.intervalDiffThresholdDays);

  return {
    minIncidentDaysForTrend: Number.isFinite(minIncidentDaysForTrend) ? minIncidentDaysForTrend : defaults.minIncidentDaysForTrend,
    minIncidentDaysForDirection: Number.isFinite(minIncidentDaysForDirection)
      ? minIncidentDaysForDirection
      : defaults.minIncidentDaysForDirection,
    rateDiffThreshold: Number.isFinite(rateDiffThreshold) ? Math.max(0, rateDiffThreshold) : defaults.rateDiffThreshold,
    intervalDiffThresholdDays: Number.isFinite(intervalDiffThresholdDays)
      ? Math.max(0, intervalDiffThresholdDays)
      : defaults.intervalDiffThresholdDays,
  };
};

const parseSubsystemConfig = (value: unknown): SubsystemConfig => {
  const record = (value ?? {}) as Partial<SubsystemConfig>;
  const customSubsystems = cleanStringArray(record.customSubsystems);
  const allowedModes: EventOperationalMode[] = ['data', 'service', 'clinical'];

  const otherLogTypeAssignments = Array.isArray(record.otherLogTypeAssignments)
    ? record.otherLogTypeAssignments
      .map((item) => {
        const raw = item as { logType?: unknown; subsystem?: unknown; mode?: unknown };
        const logType = String(raw.logType || '').trim();
        const subsystem = String(raw.subsystem || '').trim();
        const mode = String(raw.mode || '').trim() as EventOperationalMode;
        if (!logType || !subsystem || !allowedModes.includes(mode)) return null;
        return { logType, subsystem, mode };
      })
      .filter((item): item is SubsystemConfig['otherLogTypeAssignments'][number] => item !== null)
    : [];

  return { customSubsystems, otherLogTypeAssignments };
};

/**
 * Returns the app configuration context.
 *
 * @returns App configuration API.
 */
export const useAppConfig = () => {
  const context = useContext(AppConfigContext);
  if (!context) {
    throw new Error('useAppConfig must be used within AppConfigProvider');
  }
  return context;
};

/**
 * Loads app config from localStorage with safe fallbacks.
 *
 * @returns Current app config.
 */
const loadConfig = (): AppConfig => {
  try {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        hospitalName: parsed.hospitalName || DEFAULT_CONFIG.hospitalName,
        machineIds: Array.isArray(parsed.machineIds) && parsed.machineIds.length > 0
          ? cleanStringArray(parsed.machineIds)
          : [...DEFAULT_CONFIG.machineIds],
        machineAliases: Object.entries((parsed.machineAliases ?? {}) as Record<string, unknown>).reduce<Record<string, string>>(
          (acc, [machineId, alias]) => {
            const cleanId = String(machineId || '').trim();
            const cleanAlias = String(alias || '').trim();
            if (cleanId && cleanAlias) {
              acc[cleanId] = cleanAlias;
            }
            return acc;
          },
          {},
        ),
        desktopConfigPath: String(parsed.desktopConfigPath || '').trim(),
        machineLastRunTxtPaths: Object.entries((parsed.machineLastRunTxtPaths ?? {}) as Record<string, unknown>).reduce<
          Record<string, string>
        >((acc, [machineId, path]) => {
          const cleanId = String(machineId || '').trim();
          const cleanPath = String(path || '').trim();
          if (cleanId && cleanPath) {
            acc[cleanId] = cleanPath;
          }
          return acc;
        }, {}),
        databaseDirectory: String(parsed.databaseDirectory || '').trim(),
        replacementsImportPath: String(parsed.replacementsImportPath || '').trim(),
        autoScanOverdueMinutes: Math.max(1, Number(parsed.autoScanOverdueMinutes || DEFAULT_CONFIG.autoScanOverdueMinutes)),
        machineLastRunOverdueMinutes: Math.max(
          1,
          Number(parsed.machineLastRunOverdueMinutes || DEFAULT_CONFIG.machineLastRunOverdueMinutes),
        ),
        dataAccessUsername: String(parsed.dataAccessUsername || '').trim(),
        dataAccessPassword: String(parsed.dataAccessPassword || '').trim(),
        excludedEventTerms: cleanStringArray(parsed.excludedEventTerms),
        chartSettings: parseChartSettings(parsed.chartSettings),
        mlcTrendSettings: parseMlcTrendSettings(parsed.mlcTrendSettings),
        pageVisibility: parsePageVisibility(parsed.pageVisibility),
        subsystemConfig: parseSubsystemConfig(parsed.subsystemConfig),
      };
    }
  } catch {
    // fall back to defaults
  }
  return { ...DEFAULT_CONFIG };
};

/**
 * Persists app config into localStorage.
 *
 * @param config App config.
 */
const saveConfig = (config: AppConfig) => {
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
};

/**
 * Loads combined-log processor config from localStorage.
 *
 * @returns Processor configuration.
 */
const loadProcessorConfig = (): CombinedLogProcessorConfig => {
  try {
    const stored = localStorage.getItem(PROCESSOR_CONFIG_STORAGE_KEY);
    if (stored) {
      return parseProcessorConfig(JSON.parse(stored), DEFAULT_PROCESSOR_CONFIG);
    }
  } catch {
    // fall back to defaults
  }

  return {
    ...DEFAULT_PROCESSOR_CONFIG,
    inputs: [...DEFAULT_PROCESSOR_CONFIG.inputs],
    machineIds: [...DEFAULT_PROCESSOR_CONFIG.machineIds],
    excludeFiles: [...DEFAULT_PROCESSOR_CONFIG.excludeFiles],
    lastRunFile: DEFAULT_PROCESSOR_CONFIG.lastRunFile,
    filters: DEFAULT_PROCESSOR_CONFIG.filters?.map((filter) => ({
      ...filter,
      includeAny: filter.includeAny ? [...filter.includeAny] : undefined,
      exclude: filter.exclude ? [...filter.exclude] : undefined,
    })),
    conditionalFilters: [],
  };
};

/**
 * Persists processor config into localStorage.
 *
 * @param config Processor configuration.
 */
const saveProcessorConfig = (config: CombinedLogProcessorConfig) => {
  localStorage.setItem(PROCESSOR_CONFIG_STORAGE_KEY, JSON.stringify(config));
};

/**
 * Provides app and processor configuration state with persistence helpers.
 *
 * @param children Provider children.
 * @returns Configuration context provider element.
 */
export const AppConfigProvider = ({ children }: { children: ReactNode }) => {
  const [config, setConfig] = useState<AppConfig>(loadConfig);
  const [processorConfig, setProcessorConfig] = useState<CombinedLogProcessorConfig>(loadProcessorConfig);
  const shouldPersistDesktopConfigRef = useRef(false);

  const markDesktopConfigDirty = useCallback(() => {
    shouldPersistDesktopConfigRef.current = true;
  }, []);

  const findMatchingConfigFiles = useCallback((entries: TauriDirEntry[]) => {
    const matches: string[] = [];
    const walk = (nodes: TauriDirEntry[]) => {
      for (const node of nodes) {
        const name = String(node.name || '').trim().toLowerCase();
        const path = String(node.path || '').trim();
        if (node.isFile && name === DESKTOP_CONFIG_FILENAME.toLowerCase() && path) {
          matches.push(path);
        }
        if (Array.isArray(node.children) && node.children.length > 0) {
          walk(node.children);
        }
      }
    };
    walk(entries);
    return matches;
  }, []);

  const importDesktopConfigFromDefaults = useCallback(
    async (options?: { applyConfig?: boolean; verbose?: boolean }) => {
      const report: {
        attempts: Array<{ path: string; status: 'success' | 'failed'; detail: string }>;
        loadedPath?: string;
        error?: string;
      } = { attempts: [] };

      if (!isTauriRuntime()) {
        report.error = 'Desktop config auto-import is only available in the Tauri runtime.';
        return report;
      }

      const configuredPath = config.desktopConfigPath?.trim();
      const candidatePaths: string[] = [];

      // 1) Executable directory (including all subdirectories).
      try {
        const executableDir = await tauriPath.executableDir();
        candidatePaths.push(await tauriPath.join(executableDir, DESKTOP_CONFIG_FILENAME));
        try {
          const entries = await tauriFs.readDir(executableDir, true);
          candidatePaths.push(...findMatchingConfigFiles(entries));
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          report.attempts.push({ path: executableDir, status: 'failed', detail: `Unable to scan executable dir recursively: ${detail}` });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        report.attempts.push({ path: '[executableDir()]', status: 'failed', detail: `Unable to resolve executable dir: ${detail}` });
      }

      // 2) Hardcoded UNC path (if configured).
      if (DEFAULT_UNC_CONFIG_PATH.trim()) {
        const uncPath = DEFAULT_UNC_CONFIG_PATH.trim();
        if (uncPath.toLowerCase().endsWith('.json')) {
          candidatePaths.push(uncPath);
        } else {
          candidatePaths.push(await tauriPath.join(uncPath, DESKTOP_CONFIG_FILENAME));
        }
      }

      // 3) Explicit path from the Configuration page.
      if (configuredPath) {
        if (configuredPath.toLowerCase().endsWith('.json')) {
          candidatePaths.push(configuredPath);
        } else {
          candidatePaths.push(await tauriPath.join(configuredPath, DESKTOP_CONFIG_FILENAME));
        }
      }

      // 4) App config directory (internal fallback copy managed by the app).
      try {
        const appConfigDir = await tauriPath.appConfigDir();
        candidatePaths.push(await tauriPath.join(appConfigDir, DESKTOP_CONFIG_FILENAME));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        report.attempts.push({ path: '[appConfigDir()]', status: 'failed', detail: `Unable to resolve app config dir: ${detail}` });
      }

      const uniquePaths = Array.from(new Set(candidatePaths.map((item) => item.trim()).filter(Boolean)));
      for (const candidatePath of uniquePaths) {
        try {
          if (options?.verbose) console.info('[config-import] trying', candidatePath);
          const raw = await tauriFs.readTextFile(candidatePath);
          const parsed = JSON.parse(raw);

          if (options?.applyConfig !== false) {
            const parsedConfig = (parsed.config ?? parsed) as Partial<AppConfig>;
            const cleanedConfig: AppConfig = {
              hospitalName: String(parsedConfig.hospitalName || DEFAULT_CONFIG.hospitalName).trim() || DEFAULT_CONFIG.hospitalName,
              machineIds: cleanStringArray(parsedConfig.machineIds),
              machineAliases: Object.entries((parsedConfig.machineAliases ?? {}) as Record<string, unknown>).reduce<Record<string, string>>(
                (acc, [machineId, alias]) => {
                  const cleanId = String(machineId || '').trim();
                  const cleanAlias = String(alias || '').trim();
                  if (cleanId && cleanAlias) acc[cleanId] = cleanAlias;
                  return acc;
                },
                {},
              ),
              desktopConfigPath: String(parsedConfig.desktopConfigPath || '').trim(),
              machineLastRunTxtPaths: Object.entries((parsedConfig.machineLastRunTxtPaths ?? {}) as Record<string, unknown>).reduce<
                Record<string, string>
              >((acc, [machineId, path]) => {
                const cleanId = String(machineId || '').trim();
                const cleanPath = String(path || '').trim();
                if (cleanId && cleanPath) acc[cleanId] = cleanPath;
                return acc;
              }, {}),
              databaseDirectory: String(parsedConfig.databaseDirectory || '').trim(),
              replacementsImportPath: String(parsedConfig.replacementsImportPath || '').trim(),
              autoScanOverdueMinutes: Math.max(
                1,
                Number(parsedConfig.autoScanOverdueMinutes || DEFAULT_CONFIG.autoScanOverdueMinutes),
              ),
              machineLastRunOverdueMinutes: Math.max(
                1,
                Number(parsedConfig.machineLastRunOverdueMinutes || DEFAULT_CONFIG.machineLastRunOverdueMinutes),
              ),
              dataAccessUsername: String(parsedConfig.dataAccessUsername || '').trim(),
              dataAccessPassword: String(parsedConfig.dataAccessPassword || '').trim(),
              excludedEventTerms: cleanStringArray(parsedConfig.excludedEventTerms),
              chartSettings: parseChartSettings(parsedConfig.chartSettings),
              mlcTrendSettings: parseMlcTrendSettings(parsedConfig.mlcTrendSettings),
              pageVisibility: parsePageVisibility(parsedConfig.pageVisibility),
              subsystemConfig: parseSubsystemConfig(parsedConfig.subsystemConfig),
            };
            if (cleanedConfig.machineIds.length === 0) cleanedConfig.machineIds = [...DEFAULT_CONFIG.machineIds];
            setConfig(cleanedConfig);

            if (parsed.processorConfig) {
              setProcessorConfig(parseProcessorConfig(parsed.processorConfig, DEFAULT_PROCESSOR_CONFIG));
            }
          }

          report.attempts.push({ path: candidatePath, status: 'success', detail: 'Config loaded successfully' });
          report.loadedPath = candidatePath;
          return report;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          if (options?.verbose) console.warn('[config-import] failed', candidatePath, detail);
          report.attempts.push({ path: candidatePath, status: 'failed', detail });
        }
      }

      report.error = 'No readable ethos config file was found in the 4 allowed locations (exe dir recursive, DEFAULT_UNC_CONFIG_PATH, configured desktopConfigPath, appConfigDir).';
      return report;
    },
    [config.desktopConfigPath, findMatchingConfigFiles],
  );

  useEffect(() => {
    importDesktopConfigFromDefaults({ applyConfig: true }).catch(() => {
      // fall back to local storage defaults when nothing is found
    });
  }, [importDesktopConfigFromDefaults]);

  useEffect(() => {
    saveConfig(config);
  }, [config]);

  useEffect(() => {
    saveProcessorConfig(processorConfig);
  }, [processorConfig]);

  useEffect(() => {
    const persistDesktopConfig = async () => {
      if (!isTauriRuntime()) return;
      if (!shouldPersistDesktopConfigRef.current) return;

      const payload = JSON.stringify({ config, processorConfig }, null, 2);

      try {
        const executableDir = await tauriPath.executableDir();
        const startupPriorityConfigPath = await tauriPath.join(executableDir, DESKTOP_CONFIG_FILENAME);
        await tauriFs.writeTextFile(startupPriorityConfigPath, payload);
      } catch {
        // Fallback for environments where executableDir is not writable.
      }

      try {
        // Maintain a copy in appConfigDir as a stable fallback location.
        const dir = await tauriPath.appConfigDir();
        const appConfigPath = await tauriPath.join(dir, DESKTOP_CONFIG_FILENAME);
        await tauriFs.writeTextFile(appConfigPath, payload);
      } catch {
        // Silent fallback to localStorage only.
      }

      shouldPersistDesktopConfigRef.current = false;
    };

    persistDesktopConfig();
  }, [config, processorConfig]);

  const updateConfig = useCallback((newConfig: AppConfig) => {
    const cleaned: AppConfig = {
      hospitalName: newConfig.hospitalName.trim() || DEFAULT_CONFIG.hospitalName,
      machineIds: newConfig.machineIds.map((id) => id.trim()).filter((id) => id.length > 0),
      machineAliases: Object.entries(newConfig.machineAliases ?? {}).reduce<Record<string, string>>((acc, [machineId, alias]) => {
        const cleanId = machineId.trim();
        const cleanAlias = String(alias || '').trim();
        if (cleanId && cleanAlias) {
          acc[cleanId] = cleanAlias;
        }
        return acc;
      }, {}),
      desktopConfigPath: newConfig.desktopConfigPath?.trim() || '',
      machineLastRunTxtPaths: Object.entries(newConfig.machineLastRunTxtPaths ?? {}).reduce<Record<string, string>>(
        (acc, [machineId, path]) => {
          const cleanId = machineId.trim();
          const cleanPath = String(path || '').trim();
          if (cleanId && cleanPath) {
            acc[cleanId] = cleanPath;
          }
          return acc;
        },
        {},
      ),
      databaseDirectory: newConfig.databaseDirectory?.trim() || '',
      replacementsImportPath: newConfig.replacementsImportPath?.trim() || '',
      autoScanOverdueMinutes: Math.max(1, Math.round(Number(newConfig.autoScanOverdueMinutes || DEFAULT_CONFIG.autoScanOverdueMinutes))),
      machineLastRunOverdueMinutes: Math.max(
        1,
        Math.round(Number(newConfig.machineLastRunOverdueMinutes || DEFAULT_CONFIG.machineLastRunOverdueMinutes)),
      ),
      dataAccessUsername: newConfig.dataAccessUsername?.trim() || '',
      dataAccessPassword: newConfig.dataAccessPassword?.trim() || '',
      excludedEventTerms: cleanStringArray(newConfig.excludedEventTerms),
      chartSettings: parseChartSettings(newConfig.chartSettings),
      mlcTrendSettings: parseMlcTrendSettings(newConfig.mlcTrendSettings),
      pageVisibility: parsePageVisibility(newConfig.pageVisibility),
      subsystemConfig: parseSubsystemConfig(newConfig.subsystemConfig),
    };

    if (cleaned.machineIds.length === 0) {
      cleaned.machineIds = [...DEFAULT_CONFIG.machineIds];
    }

    markDesktopConfigDirty();
    setConfig(cleaned);
  }, [markDesktopConfigDirty]);

  const exportConfig = useCallback(() => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ethos_config.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [config]);

  const importConfig = useCallback(async (file: File) => {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const imported: AppConfig = {
      hospitalName: String(parsed.hospitalName || DEFAULT_CONFIG.hospitalName),
      machineIds: Array.isArray(parsed.machineIds) && parsed.machineIds.length > 0
        ? cleanStringArray(parsed.machineIds)
        : [...DEFAULT_CONFIG.machineIds],
      machineAliases: Object.entries((parsed.machineAliases ?? {}) as Record<string, unknown>).reduce<Record<string, string>>(
        (acc, [machineId, alias]) => {
          const cleanId = String(machineId || '').trim();
          const cleanAlias = String(alias || '').trim();
          if (cleanId && cleanAlias) {
            acc[cleanId] = cleanAlias;
          }
          return acc;
        },
        {},
      ),
      desktopConfigPath: String(parsed.desktopConfigPath || '').trim(),
      machineLastRunTxtPaths: Object.entries((parsed.machineLastRunTxtPaths ?? {}) as Record<string, unknown>).reduce<
        Record<string, string>
      >((acc, [machineId, path]) => {
        const cleanId = String(machineId || '').trim();
        const cleanPath = String(path || '').trim();
        if (cleanId && cleanPath) {
          acc[cleanId] = cleanPath;
        }
        return acc;
      }, {}),
      databaseDirectory: String(parsed.databaseDirectory || '').trim(),
      replacementsImportPath: String(parsed.replacementsImportPath || '').trim(),
      autoScanOverdueMinutes: Math.max(1, Number(parsed.autoScanOverdueMinutes || DEFAULT_CONFIG.autoScanOverdueMinutes)),
      machineLastRunOverdueMinutes: Math.max(
        1,
        Number(parsed.machineLastRunOverdueMinutes || DEFAULT_CONFIG.machineLastRunOverdueMinutes),
      ),
      dataAccessUsername: String(parsed.dataAccessUsername || '').trim(),
      dataAccessPassword: String(parsed.dataAccessPassword || '').trim(),
      excludedEventTerms: cleanStringArray(parsed.excludedEventTerms),
      chartSettings: parseChartSettings(parsed.chartSettings),
      mlcTrendSettings: parseMlcTrendSettings(parsed.mlcTrendSettings),
      pageVisibility: parsePageVisibility(parsed.pageVisibility),
      subsystemConfig: parseSubsystemConfig(parsed.subsystemConfig),
    };
    setConfig(imported);
  }, []);

  const updateProcessorConfig = useCallback((newConfig: CombinedLogProcessorConfig) => {
    markDesktopConfigDirty();
    setProcessorConfig(parseProcessorConfig(newConfig, DEFAULT_PROCESSOR_CONFIG));
  }, [markDesktopConfigDirty]);

  const exportProcessorConfig = useCallback(() => {
    const blob = new Blob([JSON.stringify(processorConfig, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Config.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [processorConfig]);

  const importProcessorConfig = useCallback(async (file: File) => {
    const text = await file.text();
    updateProcessorConfig(parseProcessorConfig(JSON.parse(text), DEFAULT_PROCESSOR_CONFIG));
  }, [updateProcessorConfig]);

  const getMachineLabel = useCallback((machineId: string) => {
    const alias = config.machineAliases?.[machineId]?.trim();
    return alias ? `${alias} (${machineId})` : machineId;
  }, [config.machineAliases]);

  return (
    <AppConfigContext.Provider
      value={{
        config,
        processorConfig,
        getMachineLabel,
        updateConfig,
        updateProcessorConfig,
        exportConfig,
        importConfig,
        exportProcessorConfig,
        importProcessorConfig,
        importDesktopConfigFromDefaults,
      }}
    >
      {children}
    </AppConfigContext.Provider>
  );
};
