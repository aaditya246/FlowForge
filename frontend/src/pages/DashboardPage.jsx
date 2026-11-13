import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as executionService from '../services/executionService';
import * as reliabilityService from '../services/reliabilityService';
import * as reviewService from '../services/reviewService';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage } from '../utils/apiError';

const STATES = ['PENDING', 'VALIDATING', 'PROCESSING', 'APPROVED', 'REJECTED', 'MANUAL_REVIEW', 'RETRY_PENDING', 'FAILED', 'COMPLETED'];

const STATE_BADGE = {
  PENDING: 'badge-neutral',
  VALIDATING: 'badge-neutral',
  PROCESSING: 'badge-info',
  APPROVED: 'badge-success',
  REJECTED: 'badge-danger',
  MANUAL_REVIEW: 'badge-warning',
  RETRY_PENDING: 'badge-warning',
  FAILED: 'badge-danger',
  COMPLETED: 'badge-neutral',
};

function StatCard({ label, value }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-semibold text-slate-900 mt-1">{value ?? '—'}</p>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [counts, setCounts] = useState(null);
  const [recent, setRecent] = useState([]);
  const [reliability, setReliability] = useState(null);
  const [reviewStats, setReviewStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const canSeeAdminStats = user?.role === 'admin' || user?.role === 'reviewer';

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [totalRes, recentRes, ...stateResults] = await Promise.all([
          executionService.listExecutions({ limit: 1 }),
          executionService.listExecutions({ limit: 6 }),
          ...STATES.map((s) => executionService.listExecutions({ currentState: s, limit: 1 })),
        ]);

        const byState = {};
        STATES.forEach((s, i) => {
          byState[s] = stateResults[i].total;
        });

        setCounts({ total: totalRes.total, ...byState });
        setRecent(recentRes.items);

        if (canSeeAdminStats) {
          const [relRes, revRes] = await Promise.all([
            reliabilityService.getReliabilitySummary().catch(() => null),
            reviewService.getStats().catch(() => null),
          ]);
          setReliability(relRes);
          setReviewStats(revRes);
        }
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  if (loading) return <p className="text-sm text-slate-500">Loading...</p>;

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-6">Dashboard</h1>

      {error && <p className="field-error-text mb-4">{error}</p>}

      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Requests</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Requests" value={counts?.total} />
        <StatCard label="Approved" value={counts?.APPROVED} />
        <StatCard label="Rejected" value={counts?.REJECTED} />
        <StatCard label="Manual Review" value={counts?.MANUAL_REVIEW} />
        <StatCard label="Processing" value={counts?.PROCESSING} />
        <StatCard label="Retry Pending" value={counts?.RETRY_PENDING} />
        <StatCard label="Failed" value={counts?.FAILED} />
        <StatCard label="Completed" value={counts?.COMPLETED} />
      </div>

      {canSeeAdminStats && (reliability || reviewStats) && (
        <>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Reliability &amp; Review</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {reliability && (
              <>
                <StatCard label="Pending Retries" value={reliability.pendingRetries} />
                <StatCard label="Exhausted Retries" value={reliability.exhaustedRetries} />
                <StatCard label="Interrupted Executions" value={reliability.interruptedExecutionsCount} />
                <StatCard label="Dependency Failures (24h)" value={reliability.recentDependencyFailures} />
              </>
            )}
            {reviewStats && (
              <>
                <StatCard label="Unassigned Reviews" value={reviewStats.unassigned} />
                <StatCard label="Overdue Reviews" value={reviewStats.overdue} />
                <StatCard label="Escalated Reviews" value={reviewStats.escalated} />
                <StatCard label="In Review" value={reviewStats.inReview} />
              </>
            )}
          </div>
        </>
      )}

      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Recent Activity</p>
      {recent.length === 0 ? (
        <p className="text-sm text-slate-500">No requests submitted yet. Try the Submit Request page.</p>
      ) : (
        <div className="card divide-y divide-slate-100">
          {recent.map((ex) => (
            <Link key={ex._id} to={`/executions/${ex._id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
              <div>
                <p className="text-sm font-mono text-slate-700">{ex._id}</p>
                <p className="text-xs text-slate-500">{new Date(ex.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2">
                {ex.finalDecision && <span className="text-xs font-medium text-slate-500">{ex.finalDecision}</span>}
                <span className={STATE_BADGE[ex.currentState] || 'badge-neutral'}>{ex.currentState}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
