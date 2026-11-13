import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CheckCircle2, XCircle, PauseCircle, AlertTriangle, Circle, RefreshCw } from 'lucide-react';
import * as executionService from '../services/executionService';
import * as requestService from '../services/requestService';
import { getErrorMessage } from '../utils/apiError';

const STATE_ICON = {
  APPROVED: { Icon: CheckCircle2, color: 'text-green-600' },
  COMPLETED: { Icon: CheckCircle2, color: 'text-slate-500' },
  REJECTED: { Icon: XCircle, color: 'text-red-600' },
  FAILED: { Icon: AlertTriangle, color: 'text-red-600' },
  MANUAL_REVIEW: { Icon: PauseCircle, color: 'text-amber-600' },
  RETRY_PENDING: { Icon: RefreshCw, color: 'text-amber-600' },
};

function iconFor(state) {
  return STATE_ICON[state] || { Icon: Circle, color: 'text-slate-400' };
}

export default function ExecutionDetailPage() {
  const { id } = useParams();
  const [execution, setExecution] = useState(null);
  const [request, setRequest] = useState(null);
  const [history, setHistory] = useState(null);
  const [explanation, setExplanation] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      executionService.getExecution(id),
      executionService.getExecutionHistory(id),
      executionService.getExecutionExplanation(id),
    ])
      .then(async ([exec, hist, expl]) => {
        setExecution(exec);
        setHistory(hist);
        setExplanation(expl);
        if (exec.requestId) {
          const req = await requestService.getRequest(exec.requestId);
          setRequest(req);
        }
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-sm text-slate-500">Loading...</p>;
  if (error) return <p className="field-error-text">{error}</p>;
  if (!execution) return null;

  const timeline = [
    ...(history?.events || []).map((e) => ({ kind: 'event', at: e.createdAt, ...e })),
    ...(history?.auditTrail || []).map((a) => ({ kind: 'audit', at: a.createdAt, ...a })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));

  const { Icon: FinalIcon, color: finalColor } = iconFor(execution.currentState);

  return (
    <div className="max-w-4xl">
      <Link to="/requests" className="text-xs text-brand-600 hover:text-brand-700 hover:underline">
        &larr; Back to request history
      </Link>

      <div className="flex items-center gap-2 mt-2 mb-6">
        <FinalIcon className={finalColor} size={22} />
        <h1 className="text-xl font-semibold text-slate-900">Execution {execution._id}</h1>
        <span className="text-sm text-slate-500">({execution.currentState})</span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="card p-4 text-sm space-y-1">
          <p className="font-semibold text-slate-900 mb-2">Execution Info</p>
          <p className="text-slate-500">
            Workflow version: <span className="text-slate-900">{execution.workflowVersionNumber}</span>
          </p>
          <p className="text-slate-500">
            Current stage: <span className="text-slate-900">{execution.currentStageId || '—'}</span>
          </p>
          <p className="text-slate-500">
            Final decision: <span className="text-slate-900">{execution.finalDecision || '—'}</span>
          </p>
          <p className="text-slate-500">
            Final reason: <span className="text-slate-900">{execution.finalReason || '—'}</span>
          </p>
          <p className="text-slate-500">
            Retry count: <span className="text-slate-900">{execution.retryCount}</span>
          </p>
        </div>
        <div className="card p-4 text-sm space-y-1">
          <p className="font-semibold text-slate-900 mb-2">Request Info</p>
          {request ? (
            <>
              <p className="text-slate-500">
                Status: <span className="text-slate-900">{request.status}</span>
              </p>
              <p className="text-slate-500">
                Submitted: <span className="text-slate-900">{new Date(request.createdAt).toLocaleString()}</span>
              </p>
              <pre className="text-xs bg-slate-50 text-slate-700 rounded-lg p-2 mt-2 overflow-x-auto">{JSON.stringify(request.payload, null, 2)}</pre>
            </>
          ) : (
            <p className="text-slate-500">Not available</p>
          )}
        </div>
      </div>

      {explanation?.ruleEvaluations?.length > 0 && (
        <div className="card p-4 mb-6">
          <p className="font-semibold text-slate-900 mb-3 text-sm">Rule Evaluations</p>
          <div className="space-y-3">
            {explanation.ruleEvaluations.map((re, i) => (
              <div key={i} className="text-xs">
                <p className="text-slate-700 mb-1">{re.stageReason}</p>
                {(re.ruleTrace || []).map((r) => (
                  <div key={r.ruleId} className={`rounded-lg px-3 py-2 mb-1 ${r.passed ? 'bg-green-50' : 'bg-red-50'}`}>
                    <p className="font-medium text-slate-800">
                      {r.ruleName} — {r.passed ? 'PASSED' : 'FAILED'} &rarr; {r.action}
                    </p>
                    <p className="text-slate-500 mt-0.5">{r.trace?.reason}</p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-4">
        <p className="font-semibold text-slate-900 mb-4 text-sm">Execution Timeline</p>
        <ol className="space-y-3">
          {timeline.map((item, i) => (
            <li key={i} className="flex gap-3 text-xs">
              <span className="text-slate-400 w-32 shrink-0">{new Date(item.at).toLocaleTimeString()}</span>
              <div>
                {item.kind === 'event' ? (
                  <p className="text-slate-700">
                    <span className="font-medium text-slate-900">{item.stageId || '—'}</span>
                    {item.fromState !== item.toState && (
                      <>
                        {' '}
                        &mdash; {item.fromState} &rarr; {item.toState}
                      </>
                    )}
                    {item.reason && <span className="text-slate-500"> — {item.reason}</span>}
                  </p>
                ) : (
                  <p className="text-slate-500">
                    <span className="font-medium text-slate-600">[{item.eventType}]</span> {item.decisionReason}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
