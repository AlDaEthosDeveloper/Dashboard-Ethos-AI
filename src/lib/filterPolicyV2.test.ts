import { describe, expect, test } from 'bun:test';
import { evaluateV2Line, parseProcessorConfig, v2UiStateToConfig } from '@/lib/filterPolicyV2';

const base = {
  inputs: ['in'],
  archiveDir: 'archive',
  outputDir: 'out',
  machineIds: ['M1'],
};

describe('filterPolicyV2 helpers', () => {
  test('parseProcessorConfig supports columnIndex alias in v2', () => {
    const parsed = parseProcessorConfig(
      {
        ...base,
        filterPolicyVersion: 2,
        defaultAction: 'exclude',
        resolutionStrategy: 'firstMatch',
        rules: [{ id: 'r1', action: 'include', priority: 1, any: [{ columnIndex: 2, contains: 'heartbeat' }] }],
      },
      base,
    );

    expect(parsed.filterPolicyVersion).toBe(2);
    expect(parsed.rules?.[0].any?.[0].column).toBe(2);
  });

  test('evaluateV2Line returns matched rule decision first by priority', () => {
    const policy = v2UiStateToConfig(base, {
      defaultAction: 'exclude',
      resolutionStrategy: 'firstMatch',
      rules: [
        { id: 'second', action: 'exclude', priority: 20, any: [{ column: 1, contains: 'X' }] },
        { id: 'first', action: 'include', priority: 10, any: [{ column: 1, contains: 'X' }] },
      ],
    });

    const result = evaluateV2Line('a\tXX\tb', {
      defaultAction: policy.defaultAction,
      resolutionStrategy: policy.resolutionStrategy,
      rules: policy.rules,
    });
    expect(result.decision).toBe('include');
    expect(result.matchedRuleId).toBe('first');
  });

  test('includeOverridesExclude prioritizes include over normal exclude but not hard exclude', () => {
    const resultIncludeWins = evaluateV2Line('a\tXX\tb', {
      defaultAction: 'exclude',
      resolutionStrategy: 'includeOverridesExclude',
      rules: [
        { id: 'normal-exclude', action: 'exclude', strength: 'normal', priority: 10, any: [{ column: 1, contains: 'X' }] },
        { id: 'include', action: 'include', priority: 20, any: [{ column: 1, contains: 'X' }] },
      ],
    });
    expect(resultIncludeWins.decision).toBe('include');
    expect(resultIncludeWins.matchedRuleId).toBe('include');

    const resultHardExcludeWins = evaluateV2Line('a\tXX\tb', {
      defaultAction: 'include',
      resolutionStrategy: 'includeOverridesExclude',
      rules: [
        { id: 'include', action: 'include', priority: 20, any: [{ column: 1, contains: 'X' }] },
        { id: 'hard-exclude', action: 'exclude', strength: 'hard', priority: 30, any: [{ column: 1, contains: 'X' }] },
      ],
    });
    expect(resultHardExcludeWins.decision).toBe('exclude');
    expect(resultHardExcludeWins.matchedRuleId).toBe('hard-exclude');
  });
});
