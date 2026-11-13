import { useEffect, useState } from 'react';
import * as reliabilityService from '../services/reliabilityService';
import * as requestService from '../services/requestService';
import * as workflowService from '../services/workflowService';
import { getErrorMessage } from '../utils/apiError';

const OUTCOMES = ['SUCCESS', 'FAILURE', 'TIMEOUT', 'INTERMITTENT_FAILURE', 'SLOW_RESPONSE'];

export default function FailureSimulationPage() {
  const [dependencyKey, setDependencyKey] = useState('');
  const [forcedOutcome, setForcedOutcome] = useState('SUCCESS');
  const [delayMs, setDelayMs] = useState('');
  const [failureProbability, setFailureProbability] = useState('');
  const [simulations, setSimulations] = useState([]);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [saving, setSaving] = useState(false);

  // For the "trigger a test execution" convenience action
  const [workflows, setWorkflows] = useState([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');

  async function loadAll() {
    try {
      const [simRes, logRes, wfRes] = await Promise.all([
        reliabilityService.listSimulations(),
        reliabilityService.listDependencyLogs({ limit: 20 }),
        workflowService.listWorkflows(),
      ]);
      setSimulations(simRes.simulations);
      setLogs(logRes.items);
      setWorkflows(wfRes.filter((w) => w.currentPublishedVersion > 0));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!dependencyKey.trim()) {
      setError('Enter a dependency key (e.g. credit_bureau, identity_verification).');
      return;
    }
    setSaving(true);
    try {
      await reliabilityService.upsertSimulation(dependencyKey.trim(), {
        forcedOutcome,
        ...(delayMs !== '' ? { delayMs: Number(delayMs) } : {}),
        ...(failureProbability !== '' ? { failureProbability: Number(failureProbability) } : {}),
      });
      setInfo(`Simulation for '${dependencyKey}' set to ${forcedOutcome}.`);
      await loadAll();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleTrigger() {
    setError('');
    setInfo('');
    if (!selectedWorkflowId) {
      setError('Select a published workflow to run a test execution against.');
      return;
    }
    try {
      const workflow = workflows.find((w) => w._id === selectedWorkflowId);
      const version = await workflowService.getVersion(selectedWorkflowId, workflow.currentPublishedVersion);
      const payload = {};
      (version.inputSchema || []).forEach((f) => {
        if (f.type === 'number') payload[f.name] = 1;
        else if (f.type === 'boolean') payload[f.name] = true;
        else if (f.type === 'array') payload[f.name] = [];
        else payload[f.name] = 'test';
      });
      const result = await requestService.submitRequest({ workflowId: selectedWorkflowId, payload });
      setInfo(
        `Test execution submitted — state: ${result.execution?.currentState || 'n/a'}${
          result.execution?.finalDecision ? `, decision: ${result.execution.finalDecision}` : ''
        }`
      );
      await loadAll();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Failure Simulation Console</h1>
      <p className="text-sm text-slate-500 mb-6">
        Configure how a simulated external dependency behaves, then trigger a test execution to see the effect —
        admin-only.
      </p>

      {error && <p className="field-error-text mb-4">{error}</p>}
      {info && <p className="text-sm text-green-600 mb-4">{info}</p>}

      <form onSubmit={handleSave} className="card p-4 mb-6 space-y-3">
        <p className="text-sm font-semibold text-slate-900">Configure a Dependency</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-text">Dependency Key</label>
            <input value={dependencyKey} onChange={(e) => setDependencyKey(e.target.value)} placeholder="e.g. credit_bureau" className="input-field" />
          </div>
          <div>
            <label className="label-text">Behavior</label>
            <select value={forcedOutcome} onChange={(e) => setForcedOutcome(e.target.value)} className="input-field">
              {OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-text">Artificial Delay (ms, optional)</label>
            <input type="number" value={delayMs} onChange={(e) => setDelayMs(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="label-text">Failure Probability (0-1, for INTERMITTENT_FAILURE)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="1"
              value={failureProbability}
              onChange={(e) => setFailureProbability(e.target.value)}
              className="input-field"
            />
          </div>
        </div>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Saving...' : 'Save Simulation Config'}
        </button>
      </form>

      <div className="card p-4 mb-6">
        <p className="text-sm font-semibold text-slate-900 mb-3">Active Simulations</p>
        {simulations.length === 0 ? (
          <p className="text-sm text-slate-500">No dependency simulations configured yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Dependency</th>
                <th className="pb-2">Outcome</th>
                <th className="pb-2">Delay</th>
                <th className="pb-2">Failure Prob.</th>
              </tr>
            </thead>
            <tbody>
              {simulations.map((s) => (
                <tr key={s.dependencyKey} className="border-t border-slate-100">
                  <td className="py-1.5 font-mono text-slate-700">{s.dependencyKey}</td>
                  <td className="py-1.5 text-slate-700">{s.forcedOutcome || 'SUCCESS'}</td>
                  <td className="py-1.5 text-slate-700">{s.delayMs ?? '—'}</td>
                  <td className="py-1.5 text-slate-700">{s.failureProbability ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card p-4 mb-6">
        <p className="text-sm font-semibold text-slate-900 mb-3">Trigger a Test Execution</p>
        <div className="flex items-center gap-2">
          <select value={selectedWorkflowId} onChange={(e) => setSelectedWorkflowId(e.target.value)} className="input-field flex-1">
            <option value="">Select a published workflow...</option>
            {workflows.map((w) => (
              <option key={w._id} value={w._id}>
                {w.name}
              </option>
            ))}
          </select>
          <button onClick={handleTrigger} className="btn-secondary">
            Run Test
          </button>
        </div>
      </div>

      <div className="card p-4">
        <p className="text-sm font-semibold text-slate-900 mb-3">Recent Dependency Logs</p>
        {logs.length === 0 ? (
          <p className="text-sm text-slate-500">No dependency calls logged yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Dependency</th>
                <th className="pb-2">Outcome</th>
                <th className="pb-2">Duration</th>
                <th className="pb-2">Category</th>
                <th className="pb-2">Execution</th>
                <th className="pb-2">When</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l._id} className="border-t border-slate-100">
                  <td className="py-1.5 font-mono text-slate-700">{l.dependencyKey}</td>
                  <td className={`py-1.5 font-medium ${l.success ? 'text-green-600' : 'text-red-600'}`}>{l.simulatedOutcome || l.status}</td>
                  <td className="py-1.5 text-slate-700">{l.latencyMs}ms</td>
                  <td className="py-1.5 text-slate-700">{l.errorCategory || '—'}</td>
                  <td className="py-1.5 font-mono text-slate-500">{String(l.executionId).slice(-8)}</td>
                  <td className="py-1.5 text-slate-500">{new Date(l.createdAt).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
