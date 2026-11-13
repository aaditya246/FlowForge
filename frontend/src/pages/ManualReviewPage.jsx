import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as reviewService from '../services/reviewService';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage } from '../utils/apiError';

const STATUS_BADGE = {
  PENDING: 'badge-neutral',
  ASSIGNED: 'badge-info',
  IN_REVIEW: 'badge-info',
  APPROVED: 'badge-success',
  REJECTED: 'badge-danger',
  MORE_INFORMATION_REQUIRED: 'badge-warning',
  CANCELLED: 'badge-neutral',
  ESCALATED: 'badge-danger',
};

const STATUS_OPTIONS = ['PENDING', 'ASSIGNED', 'IN_REVIEW', 'MORE_INFORMATION_REQUIRED', 'ESCALATED', 'APPROVED', 'REJECTED', 'CANCELLED'];

export default function ManualReviewPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const limit = 20;

  const canSeeStats = user?.role === 'admin' || user?.role === 'reviewer';

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = { page, limit };
      if (status) params.status = status;
      if (unassignedOnly) params.unassigned = true;

      const requests = [reviewService.listReviews(params)];
      if (canSeeStats) requests.push(reviewService.getStats());
      const [reviewsRes, statsRes] = await Promise.all(requests);

      setReviews(reviewsRes.items);
      setTotal(reviewsRes.total);
      if (statsRes) setStats(statsRes);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, unassignedOnly]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-6">Manual Review</h1>

      {error && <p className="field-error-text mb-4">{error}</p>}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Pending" value={stats.pending} />
          <StatCard label="Assigned" value={stats.assigned} />
          <StatCard label="In Review" value={stats.inReview} />
          <StatCard label="Unassigned" value={stats.unassigned} />
          <StatCard label="More Info Required" value={stats.moreInformationRequired} />
          <StatCard label="Escalated" value={stats.escalated} />
          <StatCard label="Overdue" value={stats.overdue} />
          <StatCard label="Approved / Rejected" value={`${stats.approved} / ${stats.rejected}`} />
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} className="input-field w-auto py-1.5">
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 select-none">
          <input
            type="checkbox"
            checked={unassignedOnly}
            onChange={(e) => { setPage(1); setUnassignedOnly(e.target.checked); }}
            className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Unassigned only
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : reviews.length === 0 ? (
        <p className="text-sm text-slate-500">No reviews match these filters.</p>
      ) : (
        <>
          <div className="card divide-y divide-slate-100">
            {reviews.map((r) => (
              <Link key={r._id} to={`/reviews/${r._id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                <div className="min-w-0">
                  <p className="text-sm font-mono text-slate-700 truncate">{r.executionId}</p>
                  <p className="text-xs text-slate-500 truncate">{r.reason}</p>
                </div>
                <div className="flex items-center gap-3 text-xs shrink-0 ml-4">
                  <span className="text-slate-500 capitalize">{r.priority}</span>
                  {r.dueAt && <span className="text-slate-400">due {new Date(r.dueAt).toLocaleDateString()}</span>}
                  <span className={STATUS_BADGE[r.status] || 'badge-neutral'}>{r.status}</span>
                </div>
              </Link>
            ))}
          </div>

          <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
            <span>
              Page {page} of {Math.max(1, Math.ceil(total / limit))} ({total} total)
            </span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="btn-secondary disabled:opacity-40">
                Previous
              </button>
              <button onClick={() => setPage((p) => p + 1)} disabled={page * limit >= total} className="btn-secondary disabled:opacity-40">
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-semibold text-slate-900 mt-1">{value ?? '—'}</p>
    </div>
  );
}
