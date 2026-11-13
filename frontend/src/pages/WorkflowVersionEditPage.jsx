import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as workflowService from '../services/workflowService';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage } from '../utils/apiError';

function JsonField({ label, value, onChange, rows = 10, readOnly }) {
  return (
    <div>
      <label className="label-text">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        spellCheck={false}
        rows={rows}
        className="w-full font-mono text-xs rounded-lg border border-slate-300 bg-slate-50 text-slate-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 disabled:opacity-60"
      />
    </div>
  );
}

export default function WorkflowVersionEditPage() {
  const { id, version } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [stagesText, setStagesText] = useState('');
  const [rulesText, setRulesText] = useState('');
  const [startStageId, setStartStageId] = useState('');
  const [conflictResolution, setConflictResolution] = useState('priority');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState(null);
  const [testContext, setTestContext] = useState('{\n  \n}');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  async function load() {
    try {
      const v = await workflowService.getVersion(id, version);
      setData(v);
      setStagesText(JSON.stringify(v.stages || [], null, 2));
      setRulesText(JSON.stringify(v.rules || [], null, 2));
      setStartStageId(v.startStageId || '');
      setConflictResolution(v.conflictResolution || 'priority');
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, version]);

  const isDraft = data?.status === 'draft';
  const canEdit = user?.role === 'admin' && isDraft;

  async function handleSave() {
    setError('');
    setInfo('');
    let stages;
    let rules;
    try {
      stages = JSON.parse(stagesText);
      rules = JSON.parse(rulesText);
    } catch (err) {
      setError(`Invalid JSON: ${err.message}`);
      return;
    }
    setSaving(true);
    try {
      const updated = await workflowService.updateVersion(id, version, {
        stages,
        rules,
        startStageId: startStageId || null,
        conflictResolution,
      });
      setData(updated);
      setInfo('Draft saved.');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    setError('');
    try {
      const res = await workflowService.validateVersion(id, version);
      setValidation(res);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handlePublish() {
    setError('');
    try {
      const updated = await workflowService.publishVersion(id, version);
      setData(updated);
      setInfo(`Version ${updated.version} published.`);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleTest() {
    setError('');
    let context;
    try {
      context = JSON.parse(testContext);
    } catch (err) {
      setError(`Invalid JSON in sample input: ${err.message}`);
      return;
    }
    setTesting(true);
    try {
      const result = await workflowService.testVersionRules(id, version, context);
      setTestResult(result);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setTesting(false);
    }
  }

  if (!data) return <p className="text-sm text-slate-500">Loading...</p>;

  return (
    <div className="max-w-4xl">
      <Link to={`/workflows/${id}`} className="text-xs text-brand-600 hover:text-brand-700 hover:underline">
        &larr; Back to workflow
      </Link>
      <div className="flex items-center justify-between mt-2 mb-6">
        <h1 className="text-xl font-semibold text-slate-900">
          Version {data.version} <span className="text-sm font-normal text-slate-500">({data.status})</span>
        </h1>
        {canEdit && (
          <div className="flex gap-2">
            <button onClick={handleValidate} className="btn-secondary">
              Validate
            </button>
            <button onClick={handleSave} disabled={saving} className="btn-secondary">
              {saving ? 'Saving...' : 'Save Draft'}
            </button>
            <button onClick={handlePublish} className="btn-primary">
              Publish
            </button>
          </div>
        )}
      </div>

      {error && <p className="field-error-text mb-4 whitespace-pre-wrap">{error}</p>}
      {info && <p className="text-sm text-green-600 mb-4">{info}</p>}

      {validation && (
        <div className={`mb-4 rounded-lg p-3 text-sm ${validation.valid ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {validation.valid ? (
            'Configuration is valid and ready to publish.'
          ) : (
            <ul className="list-disc list-inside space-y-0.5">
              {validation.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="label-text">Start Stage ID</label>
          <input value={startStageId} onChange={(e) => setStartStageId(e.target.value)} readOnly={!canEdit} className="input-field" />
        </div>
        <div>
          <label className="label-text">Conflict Resolution</label>
          <select value={conflictResolution} onChange={(e) => setConflictResolution(e.target.value)} disabled={!canEdit} className="input-field">
            <option value="priority">priority</option>
            <option value="first_match">first_match</option>
            <option value="all_must_pass">all_must_pass</option>
          </select>
        </div>
      </div>

      <div className="space-y-4 mb-8">
        <JsonField label="Stages (JSON)" value={stagesText} onChange={setStagesText} readOnly={!canEdit} rows={12} />
        <JsonField label="Rules (JSON)" value={rulesText} onChange={setRulesText} readOnly={!canEdit} rows={12} />
      </div>

      <div className="card p-4">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Test Rules Against Sample Input</h2>
        <JsonField label="Sample Input (JSON)" value={testContext} onChange={setTestContext} rows={5} />
        <button onClick={handleTest} disabled={testing} className="btn-primary mt-3">
          {testing ? 'Evaluating...' : 'Run Evaluation'}
        </button>

        {testResult && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-700">
              Decision: <span className="font-semibold text-slate-900">{testResult.outcome}</span>{' '}
              {testResult.decidingRuleId && <span className="text-slate-500">(by {testResult.decidingRuleId})</span>}
            </p>
            <div className="text-xs space-y-1">
              {testResult.rulesEvaluated.map((r) => (
                <div key={r.ruleId} className={`rounded-lg px-3 py-2 ${r.passed ? 'bg-green-50' : 'bg-red-50'}`}>
                  <p className="font-medium text-slate-800">
                    {r.ruleName} — {r.passed ? 'PASSED' : 'FAILED'} &rarr; {r.action}
                  </p>
                  <p className="text-slate-500 mt-0.5">{r.trace?.reason}</p>
                </div>
              ))}
              {testResult.skippedRules?.length > 0 && (
                <p className="text-slate-500">
                  Skipped: {testResult.skippedRules.map((s) => `${s.ruleName} (${s.reason})`).join(', ')}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
