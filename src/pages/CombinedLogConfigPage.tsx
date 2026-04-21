import { type JSX, useEffect, useRef, useState } from 'react';
import { Download, Plus, Save, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAppConfig, type CombinedLogProcessorConfig, type ProcessorConditionalRule, type ProcessorFilter } from '@/contexts/AppConfigContext';
import {
  configToUiState,
  evaluateV2Line,
  legacyUiStateToConfig,
  v2UiStateToConfig,
  type ConditionOperator,
  type ExcludeStrength,
  type FilterAction,
  type ResolutionStrategy,
  type Rule,
} from '@/lib/filterPolicyV2';
import { toast } from 'sonner';

type FilterForm = {
  columnIndex: number;
  includeAny: string;
  exclude: string;
};

type ConditionalFilterForm = {
  if: FilterForm;
  then: FilterForm[];
};

type ConditionForm = {
  column: number;
  operator: ConditionOperator;
  value: string;
  flags: string;
  not: boolean;
};

type RuleForm = {
  id: string;
  action: FilterAction;
  strength: ExcludeStrength;
  priority: number;
  all: ConditionForm[];
  any: ConditionForm[];
  none: ConditionForm[];
};

type ParserMode = 'auto' | 'thread' | 'process';
type AdditionalNodeType = 'string' | 'number' | 'boolean' | 'object' | 'array';
type AdditionalNode = {
  id: string;
  key: string;
  type: AdditionalNodeType;
  value: string;
  boolValue: boolean;
  children: AdditionalNode[];
};

const KNOWN_PROCESSOR_CONFIG_KEYS = new Set([
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

const createNodeId = () => `node-${Math.random().toString(36).slice(2, 10)}`;

const createAdditionalNode = (patch?: Partial<AdditionalNode>): AdditionalNode => ({
  id: patch?.id ?? createNodeId(),
  key: patch?.key ?? '',
  type: patch?.type ?? 'string',
  value: patch?.value ?? '',
  boolValue: patch?.boolValue ?? false,
  children: patch?.children ?? [],
});

const toAdditionalNode = (key: string, value: unknown): AdditionalNode => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return createAdditionalNode({
      key,
      type: 'object',
      children: Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => toAdditionalNode(childKey, childValue)),
    });
  }
  if (Array.isArray(value)) {
    return createAdditionalNode({
      key,
      type: 'array',
      children: value.map((item) => toAdditionalNode('', item)),
    });
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return createAdditionalNode({ key, type: 'number', value: String(value) });
  }
  if (typeof value === 'boolean') {
    return createAdditionalNode({ key, type: 'boolean', boolValue: value });
  }
  return createAdditionalNode({ key, type: 'string', value: typeof value === 'string' ? value : JSON.stringify(value ?? '') });
};

const buildAdditionalValue = (node: AdditionalNode): unknown => {
  if (node.type === 'object') return buildAdditionalObject(node.children);
  if (node.type === 'array') return node.children.map((item) => buildAdditionalValue(item));
  if (node.type === 'number') {
    const parsed = Number(node.value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (node.type === 'boolean') return node.boolValue;
  return node.value;
};

const buildAdditionalObject = (nodes: AdditionalNode[]): Record<string, unknown> =>
  nodes.reduce<Record<string, unknown>>((acc, node) => {
    const cleanKey = node.key.trim();
    if (!cleanKey) return acc;
    acc[cleanKey] = buildAdditionalValue(node);
    return acc;
  }, {});

const extractAdditionalNodes = (config: Record<string, unknown>): AdditionalNode[] =>
  Object.entries(config)
    .filter(([key]) => !KNOWN_PROCESSOR_CONFIG_KEYS.has(key))
    .map(([key, value]) => toAdditionalNode(key, value));

const validateAdditionalNodes = (nodes: AdditionalNode[], path = 'root', requireKey = true): string | null => {
  const seenKeys = new Set<string>();
  for (const [index, node] of nodes.entries()) {
    const cleanKey = node.key.trim();
    if (requireKey) {
      if (!cleanKey) return `${path}: every property needs a non-empty key.`;
      if (seenKeys.has(cleanKey)) return `${path}: duplicate key "${cleanKey}" is not allowed at the same level.`;
      seenKeys.add(cleanKey);
    }
    const nodePath = requireKey ? `${path}.${cleanKey}` : `${path}[${index}]`;

    if (node.type === 'string' && node.value.trim().length === 0) {
      return `${nodePath}: string value cannot be empty.`;
    }
    if (node.type === 'number') {
      if (node.value.trim().length === 0) return `${nodePath}: number value is required.`;
      const parsed = Number(node.value);
      if (!Number.isFinite(parsed)) return `${nodePath}: number value is invalid.`;
    }
    if (node.type === 'object') {
      if (node.children.length === 0) return `${nodePath}: object must contain at least one nested property.`;
      const nestedError = validateAdditionalNodes(node.children, nodePath, true);
      if (nestedError) return nestedError;
    }
    if (node.type === 'array') {
      if (node.children.length === 0) return `${nodePath}: array must contain at least one item.`;
      const nestedError = validateAdditionalNodes(node.children, nodePath, false);
      if (nestedError) return nestedError;
    }
  }
  return null;
};

const toFilterForm = (filter?: { columnIndex?: number; includeAny?: string[]; exclude?: string[] }): FilterForm => ({
  columnIndex: Number(filter?.columnIndex) || 0,
  includeAny: Array.isArray(filter?.includeAny) ? filter.includeAny.join(', ') : '',
  exclude: Array.isArray(filter?.exclude) ? filter.exclude.join(', ') : '',
});

const emptyCondition = (): ConditionForm => ({ column: 0, operator: 'contains', value: '', flags: '', not: false });
const emptyRule = (): RuleForm => ({ id: '', action: 'include', strength: 'normal', priority: 100, all: [emptyCondition()], any: [], none: [] });

const toConditionForm = (condition: Rule['all'][number]): ConditionForm => ({
  column: condition.column,
  operator: condition.equals !== undefined ? 'equals' : condition.regex !== undefined ? 'regex' : 'contains',
  value: condition.equals ?? condition.regex ?? condition.contains ?? '',
  flags: condition.flags ?? '',
  not: Boolean(condition.not),
});

const toRuleForm = (rule: Rule): RuleForm => ({
  id: rule.id,
  action: rule.action,
  strength: rule.strength ?? 'normal',
  priority: rule.priority,
  all: (rule.all ?? []).map(toConditionForm),
  any: (rule.any ?? []).map(toConditionForm),
  none: (rule.none ?? []).map(toConditionForm),
});

const parseFilter = (filter: FilterForm): ProcessorFilter | null => {
  const includeAny = filter.includeAny
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const exclude = filter.exclude
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (!Number.isInteger(filter.columnIndex) || (includeAny.length === 0 && exclude.length === 0)) {
    return null;
  }

  return {
    columnIndex: filter.columnIndex,
    includeAny: includeAny.length > 0 ? includeAny : undefined,
    exclude: exclude.length > 0 ? exclude : undefined,
  };
};

const parseLegacy = (filters: FilterForm[], conditionalFilters: ConditionalFilterForm[]): { filters: ProcessorFilter[]; conditionalFilters: ProcessorConditionalRule[] } => ({
  filters: filters.map(parseFilter).filter((filter): filter is ProcessorFilter => filter !== null),
  conditionalFilters: conditionalFilters
    .map((rule) => {
      const ifRule = parseFilter(rule.if);
      const thenRules = rule.then.map(parseFilter).filter((item): item is ProcessorFilter => item !== null);
      if (!ifRule || thenRules.length === 0) return null;
      return { if: ifRule, then: thenRules };
    })
    .filter((item): item is ProcessorConditionalRule => item !== null),
});

const parseAdvancedRules = (rules: RuleForm[]): Rule[] =>
  rules.map((rule) => {
    const parseCondition = (condition: ConditionForm) => {
      const base = {
        column: condition.column,
        not: condition.not || undefined,
      };
      if (condition.operator === 'equals') return { ...base, equals: condition.value };
      if (condition.operator === 'contains') return { ...base, contains: condition.value };
      return { ...base, regex: condition.value, flags: condition.flags || undefined };
    };

    return {
      id: rule.id.trim(),
      action: rule.action,
      strength: rule.action === 'exclude' ? rule.strength : undefined,
      priority: Number(rule.priority),
      all: rule.all.filter((item) => item.value.trim()).map(parseCondition),
      any: rule.any.filter((item) => item.value.trim()).map(parseCondition),
      none: rule.none.filter((item) => item.value.trim()).map(parseCondition),
    };
  });

const CombinedLogConfigPage = () => {
  const { processorConfig, updateProcessorConfig, exportProcessorConfig, importProcessorConfig } = useAppConfig();
  const uiState = configToUiState(processorConfig);

  const [inputs, setInputs] = useState<string[]>([...processorConfig.inputs]);
  const [archiveDir, setArchiveDir] = useState(processorConfig.archiveDir);
  const [outputDir, setOutputDir] = useState(processorConfig.outputDir);
  const [machineIds, setMachineIds] = useState<string[]>([...processorConfig.machineIds]);
  const [excludeFiles, setExcludeFiles] = useState<string[]>([...(processorConfig.excludeFiles ?? [])]);
  const [lastRunFile, setLastRunFile] = useState(processorConfig.lastRunFile ?? '');
  const [parserMode, setParserMode] = useState<ParserMode>(
    processorConfig.parserMode === 'thread' || processorConfig.parserMode === 'process' ? processorConfig.parserMode : 'auto',
  );
  const [parserWorkers, setParserWorkers] = useState<number>(Math.max(1, Number(processorConfig.parserWorkers ?? 1)));
  const [parseBatchSize, setParseBatchSize] = useState<number>(Math.max(1, Number(processorConfig.parseBatchSize ?? 1)));
  const [profilePerFile, setProfilePerFile] = useState<boolean>(Boolean(processorConfig.profilePerFile));
  const [additionalNodes, setAdditionalNodes] = useState<AdditionalNode[]>(extractAdditionalNodes(processorConfig as Record<string, unknown>));
  const [mode, setMode] = useState<'legacy' | 'advanced'>(uiState.mode);
  const [filters, setFilters] = useState<FilterForm[]>(uiState.legacy.filters.map((filter) => toFilterForm(filter)));
  const [conditionalFilters, setConditionalFilters] = useState<ConditionalFilterForm[]>(
    uiState.legacy.conditionalFilters.map((rule) => ({ if: toFilterForm(rule.if), then: rule.then.map((item) => toFilterForm(item)) })),
  );
  const [defaultAction, setDefaultAction] = useState<FilterAction>(uiState.advanced.defaultAction);
  const [resolutionStrategy, setResolutionStrategy] = useState<ResolutionStrategy>(uiState.advanced.resolutionStrategy);
  const [rules, setRules] = useState<RuleForm[]>(uiState.advanced.rules.map(toRuleForm));
  const [testLine, setTestLine] = useState('');
  const [testDelimiter, setTestDelimiter] = useState<'tab' | 'pipe'>('tab');
  const [testResult, setTestResult] = useState<{ decision: FilterAction; matchedRuleId: string | null } | null>(null);

  const processorFileInputRef = useRef<HTMLInputElement>(null);

  const applyProcessorConfigToForm = (rawConfig: CombinedLogProcessorConfig) => {
    const parsed = configToUiState(rawConfig);
    setInputs(Array.isArray(rawConfig.inputs) ? (rawConfig.inputs as string[]) : []);
    setArchiveDir(typeof rawConfig.archiveDir === 'string' ? rawConfig.archiveDir : '');
    setOutputDir(typeof rawConfig.outputDir === 'string' ? rawConfig.outputDir : '');
    setMachineIds(Array.isArray(rawConfig.machineIds) ? (rawConfig.machineIds as string[]) : []);
    setExcludeFiles(Array.isArray(rawConfig.excludeFiles) ? (rawConfig.excludeFiles as string[]) : []);
    setLastRunFile(typeof rawConfig.lastRunFile === 'string' ? rawConfig.lastRunFile : '');
    setParserMode(rawConfig.parserMode === 'thread' || rawConfig.parserMode === 'process' ? rawConfig.parserMode : 'auto');
    setParserWorkers(Math.max(1, Number(rawConfig.parserWorkers ?? 1)));
    setParseBatchSize(Math.max(1, Number(rawConfig.parseBatchSize ?? 1)));
    setProfilePerFile(Boolean(rawConfig.profilePerFile));
    setAdditionalNodes(extractAdditionalNodes(rawConfig as Record<string, unknown>));
    setMode(parsed.mode);
    setFilters(parsed.legacy.filters.map((filter) => toFilterForm(filter)));
    setConditionalFilters(parsed.legacy.conditionalFilters.map((rule) => ({ if: toFilterForm(rule.if), then: rule.then.map((item) => toFilterForm(item)) })));
    setDefaultAction(parsed.advanced.defaultAction);
    setResolutionStrategy(parsed.advanced.resolutionStrategy);
    setRules(parsed.advanced.rules.map(toRuleForm));
  };

  useEffect(() => {
    applyProcessorConfigToForm(processorConfig);
  }, [processorConfig]);

  const handleProcessorSave = () => {
    const cleanedInputs = inputs.map((item) => item.trim()).filter((item) => item.length > 0);
    const cleanedMachineIds = machineIds.map((item) => item.trim()).filter((item) => item.length > 0);
    const cleanedExcludeFiles = excludeFiles.map((item) => item.trim()).filter((item) => item.length > 0);
    const cleanedParserWorkers = Math.max(1, Math.round(Number(parserWorkers) || 1));
    const cleanedParseBatchSize = Math.max(1, Math.round(Number(parseBatchSize) || 1));
    const baseConfig = {
      inputs: cleanedInputs,
      archiveDir,
      outputDir,
      machineIds: cleanedMachineIds,
      excludeFiles: cleanedExcludeFiles,
      lastRunFile: lastRunFile.trim(),
      parserMode,
      parserWorkers: cleanedParserWorkers,
      parseBatchSize: cleanedParseBatchSize,
      profilePerFile,
    };
    const additionalValidationError = validateAdditionalNodes(additionalNodes);
    if (additionalValidationError) {
      toast.error(additionalValidationError);
      return;
    }
    const additionalRootProperties = buildAdditionalObject(additionalNodes);

    if (mode === 'advanced') {
      const parsedRules = parseAdvancedRules(rules);
      const validationErrors: string[] = [];
      const filterPolicyVersion = 2;
      if (filterPolicyVersion !== 2) validationErrors.push('filterPolicyVersion must be 2.');

      parsedRules.forEach((rule, ruleIndex) => {
        if (rule.action !== 'include' && rule.action !== 'exclude') validationErrors.push(`Rule #${ruleIndex + 1}: action is required.`);
        const groups = [rule.all ?? [], rule.any ?? [], rule.none ?? []];
        if (!groups.some((group) => group.length > 0)) validationErrors.push(`Rule #${ruleIndex + 1}: add at least one condition in all/any/none.`);

        (['all', 'any', 'none'] as const).forEach((groupName) => {
          (rule[groupName] ?? []).forEach((condition, conditionIndex) => {
            if (!Number.isInteger(condition.column) || condition.column < 0) {
              validationErrors.push(`Rule #${ruleIndex + 1} ${groupName}[${conditionIndex + 1}]: column must be an integer >= 0.`);
            }
            if (condition.regex !== undefined) {
              if (condition.flags && !/^[ims]*$/.test(condition.flags)) {
                validationErrors.push(`Rule #${ruleIndex + 1} ${groupName}[${conditionIndex + 1}]: flags must use only i, m, s.`);
              }
              try {
                void new RegExp(condition.regex, condition.flags ?? '');
              } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                validationErrors.push(`Rule #${ruleIndex + 1} ${groupName}[${conditionIndex + 1}]: invalid regex (${detail}).`);
              }
            }
          });
        });
      });

      if (validationErrors.length > 0) {
        toast.error(validationErrors[0]);
        return;
      }

      updateProcessorConfig({ ...additionalRootProperties, ...v2UiStateToConfig(baseConfig, { defaultAction, resolutionStrategy, rules: parsedRules }) });
      setRules(rules);
    } else {
      const legacy = parseLegacy(filters, conditionalFilters);
      updateProcessorConfig({ ...additionalRootProperties, ...legacyUiStateToConfig(baseConfig, legacy) });
      setFilters(filters);
      setConditionalFilters(conditionalFilters);
    }

    setInputs(cleanedInputs);
    setMachineIds(cleanedMachineIds);
    setExcludeFiles(cleanedExcludeFiles);
    setLastRunFile(lastRunFile.trim());
    setParserWorkers(cleanedParserWorkers);
    setParseBatchSize(cleanedParseBatchSize);
    toast.success('Combined log processor config saved.');
  };

  const handleProcessorImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await importProcessorConfig(file);
      toast.success('Combined log processor config imported.');
    } catch {
      toast.error('Failed to import processor configuration file');
    }
    e.target.value = '';
  };

  const addInput = () => setInputs((prev) => [...prev, '']);
  const removeInput = (index: number) => setInputs((prev) => prev.filter((_, i) => i !== index));
  const updateInput = (index: number, value: string) => setInputs((prev) => prev.map((item, i) => (i === index ? value : item)));
  const addFilter = () => setFilters((prev) => [...prev, { columnIndex: 0, includeAny: '', exclude: '' }]);
  const updateFilter = (index: number, key: 'columnIndex' | 'includeAny' | 'exclude', value: string | number) => {
    setFilters((prev) => prev.map((filter, i) => (i === index ? { ...filter, [key]: value } : filter)));
  };
  const removeFilter = (index: number) => setFilters((prev) => prev.filter((_, i) => i !== index));
  const addConditionalFilter = () =>
    setConditionalFilters((prev) => [...prev, { if: { columnIndex: 0, includeAny: '', exclude: '' }, then: [{ columnIndex: 0, includeAny: '', exclude: '' }] }]);
  const removeConditionalFilter = (index: number) => setConditionalFilters((prev) => prev.filter((_, i) => i !== index));
  const updateConditionalIf = (index: number, key: 'columnIndex' | 'includeAny' | 'exclude', value: string | number) => {
    setConditionalFilters((prev) => prev.map((rule, i) => (i === index ? { ...rule, if: { ...rule.if, [key]: value } } : rule)));
  };
  const addThenFilter = (ruleIndex: number) => {
    setConditionalFilters((prev) => prev.map((rule, i) => (i === ruleIndex ? { ...rule, then: [...rule.then, { columnIndex: 0, includeAny: '', exclude: '' }] } : rule)));
  };
  const updateThenFilter = (ruleIndex: number, thenIndex: number, key: 'columnIndex' | 'includeAny' | 'exclude', value: string | number) => {
    setConditionalFilters((prev) =>
      prev.map((rule, i) =>
        i === ruleIndex
          ? { ...rule, then: rule.then.map((thenFilter, j) => (j === thenIndex ? { ...thenFilter, [key]: value } : thenFilter)) }
          : rule,
      ),
    );
  };
  const removeThenFilter = (ruleIndex: number, thenIndex: number) => {
    setConditionalFilters((prev) => prev.map((rule, i) => (i === ruleIndex ? { ...rule, then: rule.then.filter((_, j) => j !== thenIndex) } : rule)));
  };

  const addMachineId = () => setMachineIds((prev) => [...prev, '']);
  const updateMachineId = (index: number, value: string) => setMachineIds((prev) => prev.map((item, i) => (i === index ? value : item)));
  const removeMachineId = (index: number) => setMachineIds((prev) => prev.filter((_, i) => i !== index));
  const addExcludeFile = () => setExcludeFiles((prev) => [...prev, '']);
  const updateExcludeFile = (index: number, value: string) => setExcludeFiles((prev) => prev.map((item, i) => (i === index ? value : item)));
  const removeExcludeFile = (index: number) => setExcludeFiles((prev) => prev.filter((_, i) => i !== index));
  const addAdditionalRootNode = () => setAdditionalNodes((prev) => [...prev, createAdditionalNode()]);

  const updateAdditionalNode = (
    nodeId: string,
    updater: (node: AdditionalNode) => AdditionalNode,
    nodes: AdditionalNode[] = additionalNodes,
  ): AdditionalNode[] =>
    nodes.map((node) => {
      if (node.id === nodeId) return updater(node);
      if (node.children.length === 0) return node;
      return { ...node, children: updateAdditionalNode(nodeId, updater, node.children) };
    });

  const removeAdditionalNode = (nodeId: string, nodes: AdditionalNode[] = additionalNodes): AdditionalNode[] =>
    nodes
      .filter((node) => node.id !== nodeId)
      .map((node) => ({ ...node, children: removeAdditionalNode(nodeId, node.children) }));

  const patchAdditionalNode = (nodeId: string, patch: Partial<AdditionalNode>) => {
    setAdditionalNodes((prev) =>
      updateAdditionalNode(
        nodeId,
        (node) => ({
          ...node,
          ...patch,
          children: patch.type ? (patch.type === 'object' || patch.type === 'array' ? node.children : []) : node.children,
        }),
        prev,
      ),
    );
  };

  const addChildAdditionalNode = (nodeId: string) => {
    setAdditionalNodes((prev) =>
      updateAdditionalNode(
        nodeId,
        (node) => ({
          ...node,
          type: 'object',
          children: [...node.children, createAdditionalNode()],
        }),
        prev,
      ),
    );
  };

  const addArrayItemAdditionalNode = (nodeId: string) => {
    setAdditionalNodes((prev) =>
      updateAdditionalNode(
        nodeId,
        (node) => ({
          ...node,
          type: 'array',
          children: [...node.children, createAdditionalNode({ key: '' })],
        }),
        prev,
      ),
    );
  };

  const updateRule = (index: number, patch: Partial<RuleForm>) => setRules((prev) => prev.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  const removeRule = (index: number) => setRules((prev) => prev.filter((_, i) => i !== index));
  const duplicateRule = (index: number) => setRules((prev) => {
    const source = prev[index];
    if (!source) return prev;
    return [...prev, { ...source, id: `${source.id || 'rule'}-copy`, all: [...source.all], any: [...source.any], none: [...source.none] }];
  });

  const addCondition = (ruleIndex: number, group: 'all' | 'any' | 'none') => {
    setRules((prev) => prev.map((rule, i) => (i === ruleIndex ? { ...rule, [group]: [...rule[group], emptyCondition()] } : rule)));
  };

  const updateCondition = (ruleIndex: number, group: 'all' | 'any' | 'none', conditionIndex: number, patch: Partial<ConditionForm>) => {
    setRules((prev) =>
      prev.map((rule, i) =>
        i === ruleIndex
          ? { ...rule, [group]: rule[group].map((item, j) => (j === conditionIndex ? { ...item, ...patch } : item)) }
          : rule,
      ),
    );
  };

  const removeCondition = (ruleIndex: number, group: 'all' | 'any' | 'none', conditionIndex: number) => {
    setRules((prev) => prev.map((rule, i) => (i === ruleIndex ? { ...rule, [group]: rule[group].filter((_, j) => j !== conditionIndex) } : rule)));
  };

  const runTestLine = () => {
    const normalizedInput = testDelimiter === 'tab'
      ? testLine.replace(/\\t/g, '\t')
      : testLine.split('|').join('\t');
    const result = evaluateV2Line(normalizedInput, { defaultAction, resolutionStrategy, rules: parseAdvancedRules(rules) });
    setTestResult(result);
  };

  const renderAdditionalNodes = (nodes: AdditionalNode[], depth = 0, requireKey = true): JSX.Element[] =>
    nodes.map((node) => (
      <div key={node.id} className="space-y-2 rounded-md border p-3" style={{ marginLeft: depth * 16 }}>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
          {requireKey ? (
            <Input value={node.key} onChange={(e) => patchAdditionalNode(node.id, { key: e.target.value })} placeholder="propertyName" />
          ) : (
            <div className="text-sm text-muted-foreground">Array item</div>
          )}
          <Select
            value={node.type}
            onValueChange={(value) => patchAdditionalNode(node.id, { type: value as AdditionalNodeType })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="string">string</SelectItem>
              <SelectItem value="number">number</SelectItem>
              <SelectItem value="boolean">boolean</SelectItem>
              <SelectItem value="object">object</SelectItem>
              <SelectItem value="array">array</SelectItem>
            </SelectContent>
          </Select>
          {node.type === 'boolean' ? (
            <div className="flex items-center gap-2 md:col-span-2">
              <Switch checked={node.boolValue} onCheckedChange={(checked) => patchAdditionalNode(node.id, { boolValue: checked })} />
              <Label>boolean value</Label>
            </div>
          ) : node.type === 'object' ? (
            <div className="md:col-span-2 text-sm text-muted-foreground">Object node (children become nested keys).</div>
          ) : node.type === 'array' ? (
            <div className="md:col-span-2 text-sm text-muted-foreground">Array node (children become list items).</div>
          ) : (
            <Input
              className="md:col-span-2"
              value={node.value}
              onChange={(e) => patchAdditionalNode(node.id, { value: e.target.value })}
              placeholder={node.type === 'number' ? '123' : 'value'}
            />
          )}
          <div className="flex gap-1 justify-end">
            {node.type === 'object' ? (
              <Button type="button" size="sm" variant="outline" onClick={() => addChildAdditionalNode(node.id)}>Add child</Button>
            ) : node.type === 'array' ? (
              <Button type="button" size="sm" variant="outline" onClick={() => addArrayItemAdditionalNode(node.id)}>Add item</Button>
            ) : null}
            <Button type="button" size="icon" variant="ghost" onClick={() => setAdditionalNodes((prev) => removeAdditionalNode(node.id, prev))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {node.type === 'object' && node.children.length > 0 ? <div className="space-y-2">{renderAdditionalNodes(node.children, depth + 1, true)}</div> : null}
        {node.type === 'array' && node.children.length > 0 ? <div className="space-y-2">{renderAdditionalNodes(node.children, depth + 1, false)}</div> : null}
      </div>
    ));
  const additionalValidationPreview = validateAdditionalNodes(additionalNodes);

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Combined Log Config</h2>
        <p className="text-sm text-muted-foreground mt-1">Create/import/export the dedicated processor Config.json file.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Combined Log Processor Config</CardTitle>
          <CardDescription>Standalone settings for the python combined log processor.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Filtering Mode</Label>
            <Select value={mode} onValueChange={(value) => setMode(value as 'legacy' | 'advanced')}>
              <SelectTrigger className="max-w-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="legacy">Legacy</SelectItem>
                <SelectItem value="advanced">Advanced (v2 rule engine)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <Label>Inputs Directories</Label>
            {inputs.map((input, index) => (
              <div key={index} className="flex gap-2 items-center">
                <Input value={input} onChange={(e) => updateInput(index, e.target.value)} placeholder="C:\\path\\to\\input" className="font-mono" />
                <Button variant="ghost" size="icon" onClick={() => removeInput(index)} className="shrink-0 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addInput} className="gap-2"><Plus className="h-4 w-4" />Add Input Directory</Button>
          </div>

          <div className="space-y-2"><Label htmlFor="archiveDir">Archive Directory</Label><Input id="archiveDir" value={archiveDir} onChange={(e) => setArchiveDir(e.target.value)} className="font-mono" /></div>
          <div className="space-y-2"><Label htmlFor="outputDir">Output Directory</Label><Input id="outputDir" value={outputDir} onChange={(e) => setOutputDir(e.target.value)} className="font-mono" /></div>
          <div className="space-y-2">
            <Label htmlFor="lastRunFile">lastRunFile</Label>
            <Input
              id="lastRunFile"
              value={lastRunFile}
              onChange={(e) => setLastRunFile(e.target.value)}
              placeholder="//Test.nl/location/for/last/runfile/last_runCombinedProcessor.txt"
              className="font-mono"
            />
          </div>
          <div className="space-y-3 rounded-md border p-3">
            <Label>Parser Performance</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>parserMode</Label>
                <Select value={parserMode} onValueChange={(value) => setParserMode(value as ParserMode)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">auto</SelectItem>
                    <SelectItem value="thread">thread</SelectItem>
                    <SelectItem value="process">process</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>parserWorkers (integer ≥ 1)</Label>
                <Input type="number" min={1} value={parserWorkers} onChange={(e) => setParserWorkers(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>parseBatchSize (integer ≥ 1)</Label>
                <Input type="number" min={1} value={parseBatchSize} onChange={(e) => setParseBatchSize(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>profilePerFile</Label>
                <div className="flex items-center gap-2 h-10">
                  <Switch checked={profilePerFile} onCheckedChange={setProfilePerFile} />
                  <span className="text-sm text-muted-foreground">{profilePerFile ? 'true' : 'false'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <Label>Additional Root Properties (tree editor)</Label>
              <Button type="button" variant="outline" size="sm" onClick={addAdditionalRootNode} className="gap-2">
                <Plus className="h-4 w-4" />Add Root Property
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Extra keys are emitted directly at config root level.
            </p>
            <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">How to use this editor</p>
              <ul className="list-disc ml-4 space-y-1">
                <li>Add a root property, set its key, then choose the value type.</li>
                <li>For <span className="font-mono">object</span>, use <span className="font-mono">Add child</span> to add one or more nested keys under it.</li>
                <li>You can add multiple nested values under the same object by adding multiple child rows.</li>
                <li>Validation blocks save if a key/value is empty, duplicated, or invalid.</li>
              </ul>
            </div>
            {additionalValidationPreview ? (
              <p className="text-xs text-destructive">Validation: {additionalValidationPreview}</p>
            ) : (
              <p className="text-xs text-emerald-600">Validation: additional root properties are valid.</p>
            )}
            <div className="space-y-2">
              {additionalNodes.length > 0 ? renderAdditionalNodes(additionalNodes) : <p className="text-sm text-muted-foreground">No additional root properties.</p>}
            </div>
          </div>

          <div className="space-y-3">
            <Label>Machine IDs</Label>
            {machineIds.map((id, index) => (
              <div key={index} className="flex gap-2 items-center">
                <Input value={id} onChange={(e) => updateMachineId(index, e.target.value)} className="font-mono" />
                <Button variant="ghost" size="icon" onClick={() => removeMachineId(index)} className="shrink-0 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addMachineId} className="gap-2"><Plus className="h-4 w-4" />Add Machine ID</Button>
          </div>

          <div className="space-y-3">
            <Label>excludeFiles</Label>
            {excludeFiles.map((fileName, index) => (
              <div key={index} className="flex gap-2 items-center">
                <Input value={fileName} onChange={(e) => updateExcludeFile(index, e.target.value)} className="font-mono" />
                <Button variant="ghost" size="icon" onClick={() => removeExcludeFile(index)} className="shrink-0 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addExcludeFile} className="gap-2"><Plus className="h-4 w-4" />Add Exclude File</Button>
          </div>

          {mode === 'legacy' ? (
            <>
              <div className="space-y-3">
                <Label>Filters</Label>
                {filters.map((filter, index) => (
                  <div key={index} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2"><Label>Column Index</Label><Button variant="ghost" size="icon" onClick={() => removeFilter(index)}><Trash2 className="h-4 w-4" /></Button></div>
                    <Input type="number" min={0} value={filter.columnIndex} onChange={(e) => updateFilter(index, 'columnIndex', Number(e.target.value))} />
                    <div className="space-y-1"><Label>includeAny (comma separated)</Label><Input value={filter.includeAny} onChange={(e) => updateFilter(index, 'includeAny', e.target.value)} /></div>
                    <div className="space-y-1"><Label>exclude (comma separated)</Label><Input value={filter.exclude} onChange={(e) => updateFilter(index, 'exclude', e.target.value)} /></div>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addFilter} className="gap-2"><Plus className="h-4 w-4" />Add Filter</Button>
              </div>

              <div className="space-y-3">
                <Label>Conditional Filters (IF / THEN)</Label>
                {conditionalFilters.map((rule, ruleIndex) => (
                  <div key={ruleIndex} className="space-y-3 rounded-md border p-3">
                    <div className="flex items-center justify-between"><Label>Rule #{ruleIndex + 1}</Label><Button variant="ghost" size="icon" onClick={() => removeConditionalFilter(ruleIndex)}><Trash2 className="h-4 w-4" /></Button></div>
                    <div className="space-y-2 rounded-md border bg-muted/30 p-3"><Label>IF condition</Label><Input type="number" min={0} value={rule.if.columnIndex} onChange={(e) => updateConditionalIf(ruleIndex, 'columnIndex', Number(e.target.value))} />
                    <Input value={rule.if.includeAny} onChange={(e) => updateConditionalIf(ruleIndex, 'includeAny', e.target.value)} placeholder="includeAny" />
                    <Input value={rule.if.exclude} onChange={(e) => updateConditionalIf(ruleIndex, 'exclude', e.target.value)} placeholder="exclude" /></div>
                    {rule.then.map((thenFilter, thenIndex) => (
                      <div key={thenIndex} className="space-y-2 rounded-md border p-3">
                        <div className="flex items-center justify-between"><Label>THEN #{thenIndex + 1}</Label><Button variant="ghost" size="icon" onClick={() => removeThenFilter(ruleIndex, thenIndex)}><Trash2 className="h-4 w-4" /></Button></div>
                        <Input type="number" min={0} value={thenFilter.columnIndex} onChange={(e) => updateThenFilter(ruleIndex, thenIndex, 'columnIndex', Number(e.target.value))} />
                        <Input value={thenFilter.includeAny} onChange={(e) => updateThenFilter(ruleIndex, thenIndex, 'includeAny', e.target.value)} placeholder="includeAny" />
                        <Input value={thenFilter.exclude} onChange={(e) => updateThenFilter(ruleIndex, thenIndex, 'exclude', e.target.value)} placeholder="exclude" />
                      </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={() => addThenFilter(ruleIndex)}>Add THEN Filter</Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addConditionalFilter} className="gap-2"><Plus className="h-4 w-4" />Add Conditional Filter</Button>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Regex + tester quick guide</p>
                <ul className="list-disc ml-4 space-y-1">
                  <li>Operator <span className="font-mono">regex</span> uses JavaScript RegExp syntax.</li>
                  <li>Supported flags in this editor: <span className="font-mono">i</span> (ignore case), <span className="font-mono">m</span> (multiline), <span className="font-mono">s</span> (dot matches newline).</li>
                  <li>Example: pattern <span className="font-mono">^(COL|STN|SPV)$</span> with flags <span className="font-mono">i</span>.</li>
                  <li><span className="font-mono">firstMatch</span>: first matching rule by lowest priority wins.</li>
                  <li><span className="font-mono">includeOverridesExclude</span>: hard excludes win, then includes beat normal excludes, then defaultAction.</li>
                  <li>For tab-delimited input, paste real tabs or typed <span className="font-mono">\\t</span> sequences.</li>
                </ul>
              </div>

              <div className="space-y-2 max-w-sm">
                <Label>defaultAction</Label>
                <Select value={defaultAction} onValueChange={(value) => setDefaultAction(value as FilterAction)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="include">include</SelectItem>
                    <SelectItem value="exclude">exclude</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 max-w-sm">
                <Label>resolutionStrategy</Label>
                <Select value={resolutionStrategy} onValueChange={(value) => setResolutionStrategy(value as ResolutionStrategy)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="firstMatch">firstMatch</SelectItem>
                    <SelectItem value="includeOverridesExclude">includeOverridesExclude</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {rules.map((rule, ruleIndex) => (
                <div key={ruleIndex} className="space-y-3 rounded-md border p-3">
                  <div className="flex items-center justify-between"><Label>Rule #{ruleIndex + 1}</Label><div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => duplicateRule(ruleIndex)}>Duplicate</Button><Button size="icon" variant="ghost" onClick={() => removeRule(ruleIndex)}><Trash2 className="h-4 w-4" /></Button></div></div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <Input value={rule.id} onChange={(e) => updateRule(ruleIndex, { id: e.target.value })} placeholder="rule id" />
                    <Select value={rule.action} onValueChange={(value) => updateRule(ruleIndex, { action: value as FilterAction })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="include">include</SelectItem><SelectItem value="exclude">exclude</SelectItem></SelectContent></Select>
                    <Input type="number" value={rule.priority} onChange={(e) => updateRule(ruleIndex, { priority: Number(e.target.value) })} placeholder="priority" />
                  </div>
                  {rule.action === 'exclude' ? (
                    <div className="max-w-sm">
                      <Label>Exclude strength</Label>
                      <Select value={rule.strength} onValueChange={(value) => updateRule(ruleIndex, { strength: value as ExcludeStrength })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="normal">normal</SelectItem>
                          <SelectItem value="hard">hard</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}

                  {(['all', 'any', 'none'] as const).map((group) => (
                    <div key={group} className="space-y-2 rounded border p-2">
                      <div className="flex items-center justify-between"><Label>{group.toUpperCase()} group</Label><Button size="sm" variant="outline" onClick={() => addCondition(ruleIndex, group)}>Add condition</Button></div>
                      {rule[group].map((condition, conditionIndex) => (
                        <div key={conditionIndex} className="grid grid-cols-1 md:grid-cols-6 gap-2 items-center">
                          <Input type="number" min={0} value={condition.column} onChange={(e) => updateCondition(ruleIndex, group, conditionIndex, { column: Number(e.target.value) })} placeholder="column" />
                          <Select value={condition.operator} onValueChange={(value) => updateCondition(ruleIndex, group, conditionIndex, { operator: value as ConditionOperator })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="equals">equals</SelectItem><SelectItem value="contains">contains</SelectItem><SelectItem value="regex">regex</SelectItem></SelectContent></Select>
                          <Input className="md:col-span-2" value={condition.value} onChange={(e) => updateCondition(ruleIndex, group, conditionIndex, { value: e.target.value })} placeholder="value" />
                          {condition.operator === 'regex' ? <Input value={condition.flags} onChange={(e) => updateCondition(ruleIndex, group, conditionIndex, { flags: e.target.value })} placeholder="flags i/m/s" /> : <div />}
                          <div className="flex items-center gap-2"><Switch checked={condition.not} onCheckedChange={(checked) => updateCondition(ruleIndex, group, conditionIndex, { not: checked })} /><Label>NOT</Label></div>
                          <Button size="icon" variant="ghost" onClick={() => removeCondition(ruleIndex, group, conditionIndex)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setRules((prev) => [...prev, emptyRule()])} className="gap-2"><Plus className="h-4 w-4" />Add rule</Button>

              <div className="space-y-2 rounded-md border p-3">
                <Label>Test line helper</Label>
                <Input value={testLine} onChange={(e) => setTestLine(e.target.value)} placeholder="Paste one TSV line" className="font-mono" />
                <div className="flex flex-wrap gap-2 items-center">
                  <Select value={testDelimiter} onValueChange={(value) => setTestDelimiter(value as 'tab' | 'pipe')}>
                    <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tab">Input is TAB-delimited</SelectItem>
                      <SelectItem value="pipe">Input is | delimited</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" onClick={runTestLine}>Run test</Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {testResult
                    ? <>Decision: <strong>{testResult.decision}</strong>{testResult.matchedRuleId ? ` (matched rule: ${testResult.matchedRuleId})` : ' (no rule matched; defaultAction used)'} using <span className="font-mono">{resolutionStrategy}</span>.</>
                    : 'No test run yet. Click "Run test" to evaluate the current line against the current in-memory rules.'}
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleProcessorSave} className="gap-2"><Save className="h-4 w-4" />Save Processor Config</Button>
            <Button variant="outline" onClick={exportProcessorConfig} className="gap-2"><Download className="h-4 w-4" />Export Config.json</Button>
            <Button variant="outline" onClick={() => processorFileInputRef.current?.click()} className="gap-2"><Upload className="h-4 w-4" />Import Config.json</Button>
            <input ref={processorFileInputRef} type="file" accept=".json" className="hidden" onChange={handleProcessorImport} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default CombinedLogConfigPage;
