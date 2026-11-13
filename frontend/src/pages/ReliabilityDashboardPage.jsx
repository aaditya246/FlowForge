import { useEffect, useState } from 'react';
import * as reliabilityService from '../services/reliabilityService';
import { getErrorMessage } from '../utils/apiError';

function SummaryCard({ label, value }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-semibold text-slate-900 mt-1">{value}</p>
    </div>
  );
}

function retryBadge(result) {
  if (result === 'succeeded') return 'badge-success';
  if (result === 'exhausted' || result === 'failed') return 'badge-danger';
  return 'badge-warning';
}

export default function ReliabilityDashboardPage() {
  const [summary, setSummary] = useState(null);
  const [retries, setRetries] = useState([]);
  const [recovery, setRecovery] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(null);

  async function loadAll() {
    try {
      const [summaryRes, retriesRes, recoveryRes] = await Promise.all([
        reliabilityService.getReliabilitySummary(),
        reliabilityService.listRetries({ limit: 20 }),
        reliabilityService.listRecovery({ limit: 20 }),
      ]);
      setSummary(summaryRes);
      setRetries(retriesRes.items);
      setRecovery(recoveryRes.items);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleTriggerRecovery(executionId) {
    setTriggering(executionId);
    setError('');
    try {
      await reliabilityService.triggerRecovery(executionId);
      await loadAll();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setTriggering(null);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading...</p>;

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-6">Retry &amp; Recovery Dashboard</h1>
      {error && <p className="field-error-text mb-4">{error}</p>}

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <SummaryCard label="Pending Retries" value={summary.pendingRetries} />
          <SummaryCard label="Exhausted Retries" value={summary.exhaustedRetries} />
          <SummaryCard label="Interrupted Executions" value={summary.interruptedExecutionsCount} />
          <SummaryCard label="Dependency Failures (24h)" value={summary.recentDependencyFailures} />
        </div>
      )}

      <div className="card p-4 mb-6">
        <p className="text-sm font-semibold text-slate-900 mb-3">Retry Records</p>
        {retries.length === 0 ? (
          <p className="text-sm text-slate-500">No retry activity yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Execution</th>
                <th className="pb-2">Attempt</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Scheduled At</th>
                <th className="pb-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {retries.map((r) => (
                <tr key={r._id} className="border-t border-slate-100">
                  <td className="py-1.5 font-mono text-slate-500">{String(r.executionId).slice(-8)}</td>
                  <td className="py-1.5 text-slate-700">{r.attemptNumber}</td>
                  <td className="py-1.5">
                    <span className={retryBadge(r.result)}>{r.result}</span>
                  </td>
                  <td className="py-1.5 text-slate-500">{new Date(r.scheduledAt).toLocaleString()}</td>
                  <td className="py-1.5 text-slate-500">{r.retryReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card p-4">
        <p className="text-sm font-semibold text-slate-900 mb-3">Recovery Candidates</p>
        {recovery.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing currently needs recovery.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2">Execution</th>
                <th className="pb-2">Kind</th>
                <th className="pb-2">Last State / Attempt</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {recovery.map((item, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1.5 font-mono text-slate-500">{String(item.executionId).slice(-8)}</td>
                  <td className="py-1.5 text-slate-700">{item.kind === 'interrupted_execution' ? 'Interrupted' : 'Due Retry'}</td>
                  <td className="py-1.5 text-slate-700">{item.lastKnownState || `attempt ${item.attemptNumber}`}</td>
                  <td className="py-1.5">
                    <button
                      onClick={() => handleTriggerRecovery(item.executionId)}
                      disabled={triggering === item.executionId}
                      className="btn-secondary py-1 text-xs"
                    >
                      {triggering === item.executionId ? 'Recovering...' : 'Recover Now'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
