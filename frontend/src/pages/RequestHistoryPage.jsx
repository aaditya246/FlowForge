import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as executionService from '../services/executionService';
import { getErrorMessage } from '../utils/apiError';

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

export default function RequestHistoryPage() {
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  useEffect(() => {
    setLoading(true);
    executionService
      .listExecutions({ page, limit })
      .then((res) => {
        setExecutions(res.items);
        setTotal(res.total);
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [page]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-6">Request History</h1>

      {error && <p className="field-error-text mb-4">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : executions.length === 0 ? (
        <p className="text-sm text-slate-500">No requests submitted yet.</p>
      ) : (
        <>
          <div className="card divide-y divide-slate-100">
            {executions.map((ex) => (
              <Link key={ex._id} to={`/executions/${ex._id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                <div>
                  <p className="text-sm font-mono text-slate-700">{ex._id}</p>
                  <p className="text-xs text-slate-500">
                    Submitted {new Date(ex.createdAt).toLocaleString()} &middot; version {ex.workflowVersionNumber}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {ex.finalDecision && <span className="text-xs font-medium text-slate-500">{ex.finalDecision}</span>}
                  <span className={STATE_BADGE[ex.currentState] || 'badge-neutral'}>{ex.currentState}</span>
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
