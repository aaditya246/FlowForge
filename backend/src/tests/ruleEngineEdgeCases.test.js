const ruleEngine = require('../services/ruleEngine');
const { RuleEngineError } = require('../services/ruleEngine');

function rule(overrides) {
  return {
    ruleId: 'R1',
    name: 'Test rule',
    priority: 0,
    enabled: true,
    onPass: 'APPROVE',
    onFail: 'REJECT',
    ...overrides,
  };
}

describe('Rule engine — additional edge cases', () => {
  it('rejects an empty condition object', () => {
    expect(() => ruleEngine.evaluate([rule({ condition: {} })], {})).toThrow(RuleEngineError);
  });

  it('rejects a rule with no condition at all', () => {
    expect(() => ruleEngine.evaluate([{ ruleId: 'R1', name: 'x' }], {})).toThrow(RuleEngineError);
  });

  it('handles a type mismatch (string compared numerically) without crashing', () => {
    const result = ruleEngine.evaluate(
      [rule({ condition: { field: 'score', operator: '>=', value: 700 } })],
      { score: 'not-a-number' }
    );
    // 'not-a-number' >= 700 is a valid (if nonsensical) JS comparison; engine must not throw.
    expect(['APPROVE', 'REJECT']).toContain(result.outcome);
  });

  it('handles null and undefined context gracefully', () => {
    expect(() =>
      ruleEngine.evaluate([rule({ condition: { field: 'x', operator: 'EXISTS' } })], null)
    ).not.toThrow();
    expect(() =>
      ruleEngine.evaluate([rule({ condition: { field: 'x', operator: 'EXISTS' } })], undefined)
    ).not.toThrow();
  });

  it('rejects an and/or with an empty array', () => {
    const errors = ruleEngine.validateRules([rule({ condition: { and: [] } })]);
    expect(errors.some((e) => e.includes('non-empty array'))).toBe(true);
  });

  it('rejects a condition with both "and" and "or" at the same node', () => {
    const errors = ruleEngine.validateRules([
      rule({
        condition: {
          and: [{ field: 'a', operator: 'EXISTS' }],
          or: [{ field: 'b', operator: 'EXISTS' }],
        },
      }),
    ]);
    expect(errors.some((e) => e.includes("only one of"))).toBe(true);
  });

  it('IN/NOT_IN reject a non-array value at validation time', () => {
    const errors = ruleEngine.validateRules([
      rule({ condition: { field: 'x', operator: 'IN', value: 'not-an-array' } }),
    ]);
    expect(errors.some((e) => e.includes('to be an array'))).toBe(true);
  });

  it('rejects an empty rules array evaluation gracefully (no rules -> CONTINUE)', () => {
    const result = ruleEngine.evaluate([], { anything: true });
    expect(result.outcome).toBe('CONTINUE');
    expect(result.rulesEvaluated).toEqual([]);
  });

  it('rejects null/undefined rules array input safely', () => {
    expect(() => ruleEngine.evaluate(null, {})).not.toThrow();
    expect(ruleEngine.evaluate(undefined, {}).outcome).toBe('CONTINUE');
  });

  it('never has a field access path that can escape to prototype pollution', () => {
    const result = ruleEngine.evaluate(
      [rule({ condition: { field: '__proto__.polluted', operator: '==', value: 'x' } })],
      { safe: true }
    );
    expect(result.outcome).toBe('REJECT');
    expect({}.polluted).toBeUndefined();
  });
});
