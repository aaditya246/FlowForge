const { validateWorkflowConfig } = require('../services/workflowEngine/validateConfig');

function baseValidConfig() {
  return {
    startStageId: 'validate',
    stages: [
      { stageId: 'validate', name: 'Validate', order: 1, type: 'validation', onSuccess: 'evaluate', onFailure: 'REJECTED' },
      { stageId: 'evaluate', name: 'Evaluate', order: 2, type: 'rule_evaluation', ruleGroup: 'main', onSuccess: 'terminal', onFailure: 'terminal' },
      { stageId: 'terminal', name: 'Terminal', order: 3, type: 'terminal' },
    ],
    rules: [
      {
        ruleId: 'R1',
        name: 'Rule 1',
        group: 'main',
        condition: { field: 'x', operator: 'EXISTS' },
        onPass: 'APPROVE',
        onFail: 'REJECT',
      },
    ],
  };
}

describe('validateWorkflowConfig', () => {
  it('accepts a well-formed configuration', () => {
    expect(validateWorkflowConfig(baseValidConfig())).toEqual([]);
  });

  it('rejects a configuration with no stages', () => {
    const errors = validateWorkflowConfig({ ...baseValidConfig(), stages: [] });
    expect(errors.some((e) => e.includes('at least one stage'))).toBe(true);
  });

  it('rejects duplicate stage IDs', () => {
    const config = baseValidConfig();
    config.stages.push({ stageId: 'validate', name: 'Dup', order: 4, type: 'validation' });
    const errors = validateWorkflowConfig(config);
    expect(errors.some((e) => e.includes('duplicate stageId'))).toBe(true);
  });

  it('rejects a missing startStageId', () => {
    const config = baseValidConfig();
    config.startStageId = null;
    const errors = validateWorkflowConfig(config);
    expect(errors.some((e) => e.includes('startStageId'))).toBe(true);
  });

  it('rejects a startStageId that does not match any stage', () => {
    const config = baseValidConfig();
    config.startStageId = 'nonexistent';
    const errors = validateWorkflowConfig(config);
    expect(errors.some((e) => e.includes("not a defined stage"))).toBe(true);
  });

  it('rejects a transition referencing an unknown stage', () => {
    const config = baseValidConfig();
    config.stages[0].onSuccess = 'does_not_exist';
    const errors = validateWorkflowConfig(config);
    expect(errors.some((e) => e.includes('references unknown stage'))).toBe(true);
  });

  it('accepts transitions that point to terminal keywords (APPROVED/REJECTED/etc.)', () => {
    const config = baseValidConfig();
    config.stages[0].onFailure = 'REJECTED';
    expect(validateWorkflowConfig(config)).toEqual([]);
  });

  it('rejects a configuration with no terminal stage', () => {
    const config = baseValidConfig();
    config.stages = config.stages.filter((s) => s.type !== 'terminal');
    const errors = validateWorkflowConfig(config);
    expect(errors.some((e) => e.includes('terminal stage'))).toBe(true);
  });

  it('rejects an invalid stage type', () => {
    const config = baseValidConfig();
    config.stages[0].type = 'not_a_real_type';
    const errors = validateWorkflowConfig(config);
    expect(errors.some((e) => e.includes('invalid type'))).toBe(true);
  });

  it('rejects a rule_evaluation stage whose ruleGroup has no matching rules', () => {
    const config = baseValidConfig();
    config.stages[1].ruleGroup = 'nonexistent_group';
    const errors = validateWorkflowConfig(config);
    expect(errors.some((e) => e.includes('no matching rules'))).toBe(true);
  });

  it('rejects negative retry configuration', () => {
    const config = baseValidConfig();
    config.stages[1].retry = { maxAttempts: -1, delayMs: -5 };
    const errors = validateWorkflowConfig(config);
    expect(errors.some((e) => e.includes('maxAttempts'))).toBe(true);
    expect(errors.some((e) => e.includes('delayMs'))).toBe(true);
  });

  it('rejects invalid rule definitions embedded in the version', () => {
    const config = baseValidConfig();
    config.rules[0].condition = { field: 'x', operator: 'NOT_A_REAL_OPERATOR', value: 1 };
    const errors = validateWorkflowConfig(config);
    expect(errors.some((e) => e.includes('unsupported operator'))).toBe(true);
  });

  it('rejects duplicate rule IDs', () => {
    const config = baseValidConfig();
    config.rules.push({ ...config.rules[0] });
    const errors = validateWorkflowConfig(config);
    expect(errors.some((e) => e.includes('duplicate ruleId'))).toBe(true);
  });

  it('handles a completely empty/garbage object without throwing', () => {
    expect(() => validateWorkflowConfig({})).not.toThrow();
    expect(() => validateWorkflowConfig(null)).not.toThrow();
    expect(validateWorkflowConfig(null).length).toBeGreaterThan(0);
  });
});
