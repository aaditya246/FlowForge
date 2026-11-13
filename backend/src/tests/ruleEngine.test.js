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

describe('ruleEngine.evaluate — leaf operators', () => {
  it('passes a mandatory field check when present', () => {
    const result = ruleEngine.evaluate(
      [rule({ condition: { field: 'name', operator: 'MANDATORY' } })],
      { name: 'Alice' }
    );
    expect(result.outcome).toBe('APPROVE');
  });

  it('fails a mandatory field check when missing', () => {
    const result = ruleEngine.evaluate(
      [rule({ condition: { field: 'name', operator: 'MANDATORY' } })],
      {}
    );
    expect(result.outcome).toBe('REJECT');
  });

  it('evaluates equality and inequality', () => {
    const eq = ruleEngine.evaluate([rule({ condition: { field: 'status', operator: '==', value: 'active' } })], {
      status: 'active',
    });
    expect(eq.outcome).toBe('APPROVE');

    const neq = ruleEngine.evaluate([rule({ condition: { field: 'status', operator: '!=', value: 'active' } })], {
      status: 'active',
    });
    expect(neq.outcome).toBe('REJECT');
  });

  it('evaluates numeric thresholds (>, <, >=, <=)', () => {
    const ctx = { score: 750 };
    expect(ruleEngine.evaluate([rule({ condition: { field: 'score', operator: '>', value: 700 } })], ctx).outcome).toBe('APPROVE');
    expect(ruleEngine.evaluate([rule({ condition: { field: 'score', operator: '<', value: 700 } })], ctx).outcome).toBe('REJECT');
    expect(ruleEngine.evaluate([rule({ condition: { field: 'score', operator: '>=', value: 750 } })], ctx).outcome).toBe('APPROVE');
    expect(ruleEngine.evaluate([rule({ condition: { field: 'score', operator: '<=', value: 749 } })], ctx).outcome).toBe('REJECT');
  });

  it('evaluates IN / NOT_IN', () => {
    const ctx = { country: 'IN' };
    expect(
      ruleEngine.evaluate([rule({ condition: { field: 'country', operator: 'IN', value: ['IN', 'US'] } })], ctx)
        .outcome
    ).toBe('APPROVE');
    expect(
      ruleEngine.evaluate([rule({ condition: { field: 'country', operator: 'NOT_IN', value: ['IN', 'US'] } })], ctx)
        .outcome
    ).toBe('REJECT');
  });

  it('evaluates CONTAINS on arrays and strings', () => {
    expect(
      ruleEngine.evaluate([rule({ condition: { field: 'tags', operator: 'CONTAINS', value: 'vip' } })], {
        tags: ['vip', 'new'],
      }).outcome
    ).toBe('APPROVE');
    expect(
      ruleEngine.evaluate([rule({ condition: { field: 'email', operator: 'CONTAINS', value: '@acme.com' } })], {
        email: 'a@acme.com',
      }).outcome
    ).toBe('APPROVE');
  });

  it('evaluates EXISTS', () => {
    expect(
      ruleEngine.evaluate([rule({ condition: { field: 'document', operator: 'EXISTS' } })], { document: 'x' })
        .outcome
    ).toBe('APPROVE');
    expect(ruleEngine.evaluate([rule({ condition: { field: 'document', operator: 'EXISTS' } })], {}).outcome).toBe(
      'REJECT'
    );
  });
});

describe('ruleEngine.evaluate — logical operators', () => {
  it('AND requires all children to pass', () => {
    const condition = {
      and: [
        { field: 'score', operator: '>=', value: 700 },
        { field: 'income', operator: '>=', value: 50000 },
      ],
    };
    expect(ruleEngine.evaluate([rule({ condition })], { score: 750, income: 60000 }).outcome).toBe('APPROVE');
    expect(ruleEngine.evaluate([rule({ condition })], { score: 750, income: 10000 }).outcome).toBe('REJECT');
  });

  it('OR requires at least one child to pass', () => {
    const condition = {
      or: [
        { field: 'score', operator: '>=', value: 700 },
        { field: 'collateral', operator: '==', value: true },
      ],
    };
    expect(ruleEngine.evaluate([rule({ condition })], { score: 500, collateral: true }).outcome).toBe('APPROVE');
    expect(ruleEngine.evaluate([rule({ condition })], { score: 500, collateral: false }).outcome).toBe('REJECT');
  });

  it('NOT inverts the child result', () => {
    const condition = { not: { field: 'blacklisted', operator: '==', value: true } };
    expect(ruleEngine.evaluate([rule({ condition })], { blacklisted: false }).outcome).toBe('APPROVE');
    expect(ruleEngine.evaluate([rule({ condition })], { blacklisted: true }).outcome).toBe('REJECT');
  });

  it('supports nested AND/OR/NOT combinations', () => {
    const condition = {
      and: [
        { field: 'score', operator: '>=', value: 700 },
        {
          or: [
            { field: 'employment', operator: '==', value: 'salaried' },
            { not: { field: 'selfEmployedRisk', operator: '==', value: 'high' } },
          ],
        },
      ],
    };
    const r = rule({ condition });
    expect(ruleEngine.evaluate([r], { score: 750, employment: 'self', selfEmployedRisk: 'low' }).outcome).toBe(
      'APPROVE'
    );
    expect(ruleEngine.evaluate([r], { score: 750, employment: 'self', selfEmployedRisk: 'high' }).outcome).toBe(
      'REJECT'
    );
  });
});

describe('ruleEngine.evaluate — multi-rule priority and conflict resolution', () => {
  const rules = [
    rule({
      ruleId: 'MANDATORY_INCOME',
      priority: 10,
      condition: { field: 'income', operator: 'MANDATORY' },
      onPass: 'CONTINUE',
      onFail: 'REJECT',
    }),
    rule({
      ruleId: 'CREDIT_CHECK',
      priority: 5,
      condition: { field: 'creditScore', operator: '>=', value: 750 },
      onPass: 'APPROVE',
      onFail: 'MANUAL_REVIEW',
    }),
  ];

  it('evaluates higher-priority rules first and short-circuits on a terminal action', () => {
    const result = ruleEngine.evaluate(rules, { creditScore: 780 }); // income missing -> REJECT first
    expect(result.outcome).toBe('REJECT');
    expect(result.decidingRuleId).toBe('MANDATORY_INCOME');
    expect(result.skippedRules.some((s) => s.ruleId === 'CREDIT_CHECK')).toBe(true);
  });

  it('falls through to the next rule when the first is CONTINUE', () => {
    const result = ruleEngine.evaluate(rules, { income: 50000, creditScore: 780 });
    expect(result.outcome).toBe('APPROVE');
    expect(result.decidingRuleId).toBe('CREDIT_CHECK');
  });

  it('respects explicit priority ordering regardless of array order', () => {
    const reversed = [...rules].reverse();
    const result = ruleEngine.evaluate(reversed, { income: 50000, creditScore: 780 });
    expect(result.rulesEvaluated[0].ruleId).toBe('MANDATORY_INCOME');
  });

  it('skips disabled rules', () => {
    const withDisabled = [rules[0], { ...rules[1], enabled: false }];
    const result = ruleEngine.evaluate(withDisabled, { income: 50000, creditScore: 780 });
    expect(result.outcome).toBe('CONTINUE');
    expect(result.skippedRules.some((s) => s.ruleId === 'CREDIT_CHECK' && s.reason === 'disabled')).toBe(true);
  });

  it('first_match strategy stops at the very first rule', () => {
    const result = ruleEngine.evaluate(rules, { income: 50000, creditScore: 780 }, { conflictResolution: 'first_match' });
    expect(result.decidingRuleId).toBe('MANDATORY_INCOME');
    expect(result.outcome).toBe('CONTINUE'); // onPass of MANDATORY_INCOME
  });

  it('all_must_pass strategy approves only if every rule passes', () => {
    const allPass = ruleEngine.evaluate(rules, { income: 50000, creditScore: 780 }, { conflictResolution: 'all_must_pass' });
    expect(allPass.outcome).toBe('APPROVE');

    const oneFails = ruleEngine.evaluate(rules, { income: 50000, creditScore: 400 }, { conflictResolution: 'all_must_pass' });
    expect(oneFails.outcome).toBe('MANUAL_REVIEW');
  });
});

describe('ruleEngine — validation and safety', () => {
  it('rejects an invalid rule structure instead of crashing', () => {
    expect(() => ruleEngine.evaluate([{ ruleId: 'BAD' }], {})).toThrow(RuleEngineError);
  });

  it('rejects an unsupported operator', () => {
    const errors = ruleEngine.validateRules([
      rule({ condition: { field: 'x', operator: 'EXPLODE', value: 1 } }),
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('handles missing input fields without throwing', () => {
    const result = ruleEngine.evaluate(
      [rule({ condition: { field: 'nonexistent.deep.path', operator: '>=', value: 1 } })],
      {}
    );
    expect(result.outcome).toBe('REJECT');
  });

  it('never evaluates arbitrary code — condition is pure data, not a function', () => {
    const maliciousCondition = { field: 'x', operator: '==', value: 'require("fs")' };
    const result = ruleEngine.evaluate([rule({ condition: maliciousCondition })], { x: 'require("fs")' });
    // The "value" is treated as an opaque string, never executed.
    expect(result.outcome).toBe('APPROVE');
    expect(typeof maliciousCondition.value).toBe('string');
  });

  it('detects duplicate rule IDs', () => {
    const errors = ruleEngine.validateRules([
      rule({ ruleId: 'DUP', condition: { field: 'x', operator: 'EXISTS' } }),
      rule({ ruleId: 'DUP', condition: { field: 'y', operator: 'EXISTS' } }),
    ]);
    expect(errors.some((e) => e.includes('duplicate'))).toBe(true);
  });
});
