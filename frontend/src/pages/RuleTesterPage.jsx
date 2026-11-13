import { useState } from 'react';
import * as ruleService from '../services/ruleService';
import { getErrorMessage } from '../utils/apiError';

const SAMPLE_RULES = [
  {
    ruleId: 'CREDIT_CHECK',
    name: 'Minimum credit score',
    priority: 10,
    enabled: true,
    condition: { field: 'creditScore', operator: '>=', value: 750 },
    onPass: 'APPROVE',
    onFail: 'MANUAL_REVIEW',
  },
];

export default function RuleTesterPage() {
  const [rulesText, setRulesText] = useState(JSON.stringify(SAMPLE_RULES, null, 2));
  const [contextText, setContextText] = useState('{\n  "creditScore": 780\n}');
  const [conflictResolution, setConflictResolution] = useState('priority');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleEvaluate() {
    setError('');
    setResult(null);
    let rules;
    let context;
    try {
      rules = JSON.parse(rulesText);
      context = JSON.parse(contextText);
    } catch (err) {
      setError(`Invalid JSON: ${err.message}`);
      return;
    }
    setLoading(true);
    try {
      setResult(await ruleService.testEvaluate({ rules, context, conflictResolution }));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Rule Tester</h1>
      <p className="text-sm text-slate-500 mb-6">
        Try out rule definitions against sample input before saving them to a workflow version.
      </p>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="label-text">Rules (JSON array)</label>
          <textarea
            value={rulesText}
            onChange={(e) => setRulesText(e.target.value)}
            spellCheck={false}
            rows={14}
            className="w-full font-mono text-xs rounded-lg border border-slate-300 bg-slate-50 text-slate-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          />
        </div>
        <div>
          <label className="label-text">Sample Input (JSON object)</label>
          <textarea
            value={contextText}
            onChange={(e) => setContextText(e.target.value)}
            spellCheck={false}
            rows={14}
            className="w-full font-mono text-xs rounded-lg border border-slate-300 bg-slate-50 text-slate-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <label className="text-xs font-medium text-slate-500">Conflict Resolution</label>
        <select value={conflictResolution} onChange={(e) => setConflictResolution(e.target.value)} className="input-field w-auto py-1">
          <option value="priority">priority</option>
          <option value="first_match">first_match</option>
          <option value="all_must_pass">all_must_pass</option>
        </select>
        <button onClick={handleEvaluate} disabled={loading} className="btn-primary">
          {loading ? 'Evaluating...' : 'Evaluate'}
        </button>
      </div>

      {error && <p className="field-error-text mb-4 whitespace-pre-wrap">{error}</p>}

      {result && (
        <div className="card p-4">
          <p className="text-sm mb-3 text-slate-700">
            Decision: <span className="font-semibold text-slate-900">{result.outcome}</span>{' '}
            {result.decidingRuleId && <span className="text-slate-500">(by {result.decidingRuleId})</span>}
          </p>
          <div className="text-xs space-y-1">
            {result.rulesEvaluated.map((r) => (
              <div key={r.ruleId} className={`rounded-lg px-3 py-2 ${r.passed ? 'bg-green-50' : 'bg-red-50'}`}>
                <p className="font-medium text-slate-800">
                  {r.ruleName} — {r.passed ? 'PASSED' : 'FAILED'} &rarr; {r.action}
                </p>
                <p className="text-slate-500 mt-0.5">{r.trace?.reason}</p>
              </div>
            ))}
            {result.skippedRules?.length > 0 && (
              <p className="text-slate-500">
                Skipped: {result.skippedRules.map((s) => `${s.ruleName} (${s.reason})`).join(', ')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
