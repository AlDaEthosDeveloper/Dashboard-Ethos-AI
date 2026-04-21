import type { CombinedLogProcessorConfig, ProcessorConditionalRule, ProcessorFilter } from '@/contexts/AppConfigContext';

export type FilterAction = 'include' | 'exclude';
export type ConditionOperator = 'equals' | 'contains' | 'regex';
export type ResolutionStrategy = 'firstMatch' | 'includeOverridesExclude';
export type ExcludeStrength = 'normal' | 'hard';

export interface Condition {
  column: number;
  equals?: string;
  contains?: string;
  regex?: string;
  flags?: string;
  not?: boolean;
}

export interface Rule {
  id: string;
  action: FilterAction;
  priority: number;
  strength?: ExcludeStrength;
  all?: Condition[];
  any?: Condition[];
  none?: Condition[];
}

export interface FilterPolicyV2 {
  filterPolicyVersion: 2;
  defaultAction: FilterAction;
  resolutionStrategy: ResolutionStrategy;
  rules: Rule[];
}

export type LegacyUiState = {
  filters: ProcessorFilter[];
  conditionalFilters: ProcessorConditionalRule[];
};

export type V2UiState = {
  defaultAction: FilterAction;
  resolutionStrategy: ResolutionStrategy;
  rules: Rule[];
};

export const isAdvancedConfig = (config: CombinedLogProcessorConfig): boolean => config.filterPolicyVersion === 2;

const cleanStringArray = (value: unknown) =>
  Array.isArray(value) ? value.map((item) => String(item).trim()).filter((item) => item.length > 0) : [];

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

const parseCondition = (value: unknown): Condition | null => {
  const raw = (value ?? {}) as Record<string, unknown>;
  const column = Number(raw.column ?? raw.columnIndex);
  if (!Number.isInteger(column) || column < 0) return null;

  const equals = typeof raw.equals === 'string' ? raw.equals : undefined;
  const contains = typeof raw.contains === 'string' ? raw.contains : undefined;
  const regex = typeof raw.regex === 'string' ? raw.regex : undefined;
  const operatorCount = [equals, contains, regex].filter(Boolean).length;
  if (operatorCount !== 1) return null;

  const condition: Condition = { column };
  if (equals !== undefined) condition.equals = equals;
  if (contains !== undefined) condition.contains = contains;
  if (regex !== undefined) condition.regex = regex;
  if (typeof raw.flags === 'string' && raw.flags.trim()) condition.flags = raw.flags.trim();
  if (typeof raw.not === 'boolean') condition.not = raw.not;

  return condition;
};

const parseRule = (value: unknown): Rule | null => {
  const raw = (value ?? {}) as Record<string, unknown>;
  const id = String(raw.id || '').trim();
  const action = raw.action === 'include' || raw.action === 'exclude' ? raw.action : null;
  const priority = Number(raw.priority);
  if (!id || !action || !Number.isFinite(priority)) return null;

  const rule: Rule = { id, action, priority };
  if (action === 'exclude') {
    rule.strength = raw.strength === 'hard' ? 'hard' : 'normal';
  }
  for (const group of ['all', 'any', 'none'] as const) {
    if (Array.isArray(raw[group])) {
      const parsed = raw[group].map(parseCondition).filter((item): item is Condition => item !== null);
      if (parsed.length > 0) rule[group] = parsed;
    }
  }

  return rule;
};

export const parseProcessorConfig = (
  rawConfig: unknown,
  base: Pick<
    CombinedLogProcessorConfig,
    'inputs' | 'archiveDir' | 'outputDir' | 'machineIds' | 'excludeFiles' | 'lastRunFile' | 'parserMode' | 'parserWorkers' | 'parseBatchSize' | 'profilePerFile'
  >,
): CombinedLogProcessorConfig => {
  const raw = (rawConfig ?? {}) as Record<string, unknown>;
  const reservedKeys = new Set([
    'inputs',
    'archiveDir',
    'outputDir',
    'machineIds',
    'excludeFiles',
    'lastRunFile',
    'parserMode',
    'parserWorkers',
    'parseBatchSize',
    'profilePerFile',
    'filters',
    'conditionalFilters',
    'filterPolicyVersion',
    'defaultAction',
    'resolutionStrategy',
    'rules',
  ]);

  const parsedBase = {
    inputs: cleanStringArray(raw.inputs ?? base.inputs),
    archiveDir: String(raw.archiveDir ?? base.archiveDir ?? '').trim(),
    outputDir: String(raw.outputDir ?? base.outputDir ?? '').trim(),
    machineIds: cleanStringArray(raw.machineIds ?? base.machineIds),
    excludeFiles: cleanStringArray(raw.excludeFiles ?? base.excludeFiles),
    lastRunFile: String(raw.lastRunFile ?? base.lastRunFile ?? '').trim(),
    parserMode: raw.parserMode === 'thread' || raw.parserMode === 'process' ? raw.parserMode : 'auto',
    parserWorkers: Math.max(1, Math.round(Number(raw.parserWorkers ?? base.parserWorkers ?? 1))),
    parseBatchSize: Math.max(1, Math.round(Number(raw.parseBatchSize ?? base.parseBatchSize ?? 1))),
    profilePerFile: typeof raw.profilePerFile === 'boolean' ? raw.profilePerFile : Boolean(base.profilePerFile),
  };
  const additionalRootProperties = Object.fromEntries(Object.entries(raw).filter(([key]) => !reservedKeys.has(key)));

  if (Number(raw.filterPolicyVersion) === 2) {
    return {
      ...additionalRootProperties,
      ...parsedBase,
      filterPolicyVersion: 2,
      defaultAction: raw.defaultAction === 'include' ? 'include' : 'exclude',
      resolutionStrategy: raw.resolutionStrategy === 'includeOverridesExclude' ? 'includeOverridesExclude' : 'firstMatch',
      rules: Array.isArray(raw.rules) ? raw.rules.map(parseRule).filter((item): item is Rule => item !== null) : [],
    };
  }

  return {
    ...additionalRootProperties,
    ...parsedBase,
    filters: Array.isArray(raw.filters)
      ? raw.filters.map(parseProcessorFilter).filter((filter: ProcessorFilter | null): filter is ProcessorFilter => filter !== null)
      : [],
    conditionalFilters: parseConditionalRules(raw.conditionalFilters),
  };
};

export const configToUiState = (config: CombinedLogProcessorConfig): { mode: 'legacy' | 'advanced'; legacy: LegacyUiState; advanced: V2UiState } => ({
  mode: isAdvancedConfig(config) ? 'advanced' : 'legacy',
  legacy: {
    filters: (config.filters ?? []).map((filter) => ({ ...filter })),
    conditionalFilters: (config.conditionalFilters ?? []).map((rule) => ({ if: { ...rule.if }, then: rule.then.map((item) => ({ ...item })) })),
  },
  advanced: {
    defaultAction: config.defaultAction === 'include' ? 'include' : 'exclude',
    resolutionStrategy: config.resolutionStrategy === 'includeOverridesExclude' ? 'includeOverridesExclude' : 'firstMatch',
    rules: (config.rules ?? []).map((rule) => ({ ...rule })),
  },
});

export const legacyUiStateToConfig = (
  base: Pick<CombinedLogProcessorConfig, 'inputs' | 'archiveDir' | 'outputDir' | 'machineIds' | 'excludeFiles' | 'lastRunFile'>,
  legacy: LegacyUiState,
): CombinedLogProcessorConfig => ({
  ...base,
  filters: legacy.filters,
  conditionalFilters: legacy.conditionalFilters,
});

export const v2UiStateToConfig = (
  base: Pick<CombinedLogProcessorConfig, 'inputs' | 'archiveDir' | 'outputDir' | 'machineIds' | 'excludeFiles' | 'lastRunFile'>,
  advanced: V2UiState,
): CombinedLogProcessorConfig & FilterPolicyV2 => ({
  ...base,
  filterPolicyVersion: 2,
  defaultAction: advanced.defaultAction,
  resolutionStrategy: advanced.resolutionStrategy,
  rules: advanced.rules,
});

export const evaluateV2Line = (line: string, policy: V2UiState): { decision: FilterAction; matchedRuleId: string | null } => {
  const parts = line.split('\t');
  const sortedRules = [...policy.rules].sort((a, b) => a.priority - b.priority);

  const matchCondition = (condition: Condition) => {
    const value = parts[condition.column] ?? '';
    let result = false;
    if (condition.equals !== undefined) result = value === condition.equals;
    if (condition.contains !== undefined) result = value.includes(condition.contains);
    if (condition.regex !== undefined) result = new RegExp(condition.regex, condition.flags ?? '').test(value);
    return condition.not ? !result : result;
  };

  const matchedRules = sortedRules.filter((rule) => {
    const allOk = !rule.all || rule.all.every(matchCondition);
    const anyOk = !rule.any || rule.any.some(matchCondition);
    const noneOk = !rule.none || rule.none.every((item) => !matchCondition(item));
    const hasGroup = Boolean((rule.all && rule.all.length) || (rule.any && rule.any.length) || (rule.none && rule.none.length));
    return hasGroup && allOk && anyOk && noneOk;
  });

  if (policy.resolutionStrategy === 'firstMatch') {
    const first = matchedRules[0];
    if (first) {
      return { decision: first.action, matchedRuleId: first.id };
    }
    return { decision: policy.defaultAction, matchedRuleId: null };
  }

  const hardExclude = matchedRules.find((rule) => rule.action === 'exclude' && rule.strength === 'hard');
  if (hardExclude) {
    return { decision: 'exclude', matchedRuleId: hardExclude.id };
  }

  const include = matchedRules.find((rule) => rule.action === 'include');
  if (include) {
    return { decision: 'include', matchedRuleId: include.id };
  }

  const normalExclude = matchedRules.find((rule) => rule.action === 'exclude');
  if (normalExclude) {
    return { decision: 'exclude', matchedRuleId: normalExclude.id };
  }

  return { decision: policy.defaultAction, matchedRuleId: null };
};
