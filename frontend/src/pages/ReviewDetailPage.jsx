import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as reviewService from '../services/reviewService';
import * as requestService from '../services/requestService';
import * as executionService from '../services/executionService';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage } from '../utils/apiError';

export default function ReviewDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [review, setReview] = useState(null);
  const [request, setRequest] = useState(null);
  const [explanation, setExplanation] = useState(null);
  const [history, setHistory] = useState([]);
  const [reviewers, setReviewers] = useState([]);
  const [selectedReviewerId, setSelectedReviewerId] = useState('');
  const [comment, setComment] = useState('');
  const [infoExplanation, setInfoExplanation] = useState('');
  const [infoText, setInfoText] = useState('');
  const [escalationReason, setEscalationReason] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const r = await reviewService.getReview(id);
      setReview(r);

      const tasks = [
        requestService.getRequest(r.requestId).catch(() => null),
        executionService.getExecutionExplanation(r.executionId).catch(() => null),
        reviewService.getHistory(id).catch(() => []),
      ];
      if (user?.role === 'admin') tasks.push(reviewService.listReviewers().catch(() => []));

      const [req, expl, hist, revs] = await Promise.all(tasks);
      setRequest(req);
      setExplanation(expl);
      setHistory(hist);
      if (revs) setReviewers(revs);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function runAction(fn, successMessage) {
    setError('');
    setInfo('');
    setBusy(true);
    try {
      await fn();
      setInfo(successMessage);
      setComment('');
      setInfoExplanation('');
      setInfoText('');
      setEscalationReason('');
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading...</p>;
  if (!review) return <p className="field-error-text">{error || 'Review not found'}</p>;

  const isAssignedToMe = review.assignedReviewerId && user?.id === review.assignedReviewerId;
  const isMyReviewOrUnassigned = !review.assignedReviewerId || isAssignedToMe || user?.role === 'admin';
  const canDecide = (user?.role === 'reviewer' || user?.role === 'admin') && isMyReviewOrUnassigned;
  const isTerminal = ['APPROVED', 'REJECTED', 'CANCELLED'].includes(review.status);
  const canStart = canDecide && ['ASSIGNED', 'MORE_INFORMATION_REQUIRED', 'ESCALATED'].includes(review.status);
  const canDecideNow = canDecide && !isTerminal && review.status !== 'MORE_INFORMATION_REQUIRED';
  const canSubmitInfo = (user?.role === 'operator' || user?.role === 'admin') && review.status === 'MORE_INFORMATION_REQUIRED';

  return (
    <div className="max-w-4xl">
      <Link to="/review" className="text-xs text-brand-600 hover:text-brand-700 hover:underline">
        &larr; Back to manual review queue
      </Link>

      <div className="flex items-center justify-between mt-2 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Review {review._id}</h1>
          <p className="text-sm text-slate-500">{review.reason}</p>
        </div>
        <span
          className={
            review.status === 'APPROVED'
              ? 'badge-success'
              : review.status === 'REJECTED' || review.status === 'ESCALATED'
              ? 'badge-danger'
              : review.status === 'MORE_INFORMATION_REQUIRED'
              ? 'badge-warning'
              : 'badge-info'
          }
        >
          {review.status}
        </span>
      </div>

      {error && <p className="field-error-text mb-4">{error}</p>}
      {info && <p className="text-sm text-green-600 mb-4">{info}</p>}

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="card p-4 text-sm space-y-1">
          <p className="font-semibold text-slate-900 mb-2">Review Info</p>
          <p className="text-slate-500">
            Priority: <span className="text-slate-900 capitalize">{review.priority}</span>
          </p>
          <p className="text-slate-500">
            Assigned to:{' '}
            <span className="text-slate-900">
              {review.assignedReviewerId
                ? isAssignedToMe
                  ? 'You'
                  : reviewers.find((r) => r._id === review.assignedReviewerId)?.name || review.assignedReviewerId
                : 'Unassigned'}
            </span>
          </p>
          <p className="text-slate-500">
            Due: <span className="text-slate-900">{review.dueAt ? new Date(review.dueAt).toLocaleString() : '—'}</span>
          </p>
          <p className="text-slate-500">
            Decision: <span className="text-slate-900">{review.decision || '—'}</span>
          </p>
          {review.decisionReason && (
            <p className="text-slate-500">
              Reason: <span className="text-slate-900">{review.decisionReason}</span>
            </p>
          )}
          <Link to={`/executions/${review.executionId}`} className="text-brand-600 hover:underline inline-block mt-2">
            View full execution timeline &rarr;
          </Link>
        </div>

        <div className="card p-4 text-sm space-y-1">
          <p className="font-semibold text-slate-900 mb-2">Original Request</p>
          {request ? (
            <pre className="text-xs bg-slate-50 text-slate-700 rounded-lg p-2 overflow-x-auto">{JSON.stringify(request.payload, null, 2)}</pre>
          ) : (
            <p className="text-slate-500">Not available</p>
          )}
        </div>
      </div>

      {explanation?.ruleEvaluations?.length > 0 && (
        <div className="card p-4 mb-6">
          <p className="font-semibold text-slate-900 mb-3 text-sm">Why this needed manual review</p>
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

      {review.submittedInformation?.length > 0 && (
        <div className="card p-4 mb-6">
          <p className="font-semibold text-slate-900 mb-3 text-sm">Additional Information Submitted</p>
          <div className="space-y-2 text-xs">
            {review.submittedInformation.map((s, i) => (
              <div key={i} className="bg-slate-50 rounded-lg p-2">
                <p className="text-slate-700">{s.text}</p>
                <p className="text-slate-400 mt-0.5">{new Date(s.submittedAt).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin: assignment */}
      {user?.role === 'admin' && !isTerminal && (
        <div className="card p-4 mb-6">
          <p className="font-semibold text-slate-900 mb-3 text-sm">Assignment</p>
          <div className="flex items-center gap-2">
            <select value={selectedReviewerId} onChange={(e) => setSelectedReviewerId(e.target.value)} className="input-field flex-1">
              <option value="">Select a reviewer...</option>
              {reviewers.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.name} ({r.email})
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                runAction(
                  () => (review.assignedReviewerId ? reviewService.reassignReview(id, selectedReviewerId) : reviewService.assignReview(id, selectedReviewerId)),
                  'Review assigned.'
                )
              }
              disabled={busy || !selectedReviewerId}
              className="btn-primary"
            >
              {review.assignedReviewerId ? 'Reassign' : 'Assign'}
            </button>
            {review.assignedReviewerId && (
              <button onClick={() => runAction(() => reviewService.unassignReview(id), 'Review unassigned.')} disabled={busy} className="btn-secondary">
                Unassign
              </button>
            )}
          </div>
        </div>
      )}

      {/* Reviewer: start */}
      {canStart && (
        <div className="card p-4 mb-6">
          <button onClick={() => runAction(() => reviewService.startReview(id), 'Review started.')} disabled={busy} className="btn-primary">
            Start Review
          </button>
        </div>
      )}

      {/* Reviewer/admin: decision + more info + escalate */}
      {canDecideNow && (
        <div className="card p-4 mb-6 space-y-4">
          <p className="font-semibold text-slate-900 text-sm">Decision</p>
          <div>
            <label className="label-text">Comment (required for approve/reject)</label>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className="input-field" />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (!comment.trim()) return setError('A comment is required to approve.');
                if (window.confirm('Approve this request? This will resume the workflow.')) {
                  runAction(() => reviewService.approveReview(id, comment), 'Approved — workflow resumed.');
                }
              }}
              disabled={busy}
              className="btn-primary"
            >
              Approve
            </button>
            <button
              onClick={() => {
                if (!comment.trim()) return setError('A comment is required to reject.');
                if (window.confirm('Reject this request? This cannot be undone.')) {
                  runAction(() => reviewService.rejectReview(id, comment), 'Rejected — workflow resumed.');
                }
              }}
              disabled={busy}
              className="btn-danger"
            >
              Reject
            </button>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <label className="label-text">Request more information</label>
            <textarea
              value={infoExplanation}
              onChange={(e) => setInfoExplanation(e.target.value)}
              rows={2}
              placeholder="What do you need from the submitter?"
              className="input-field mb-2"
            />
            <button
              onClick={() => {
                if (!infoExplanation.trim()) return setError('An explanation is required.');
                runAction(() => reviewService.requestInformation(id, infoExplanation), 'Information requested.');
              }}
              disabled={busy}
              className="btn-secondary"
            >
              Request Information
            </button>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <label className="label-text">Escalate</label>
            <textarea
              value={escalationReason}
              onChange={(e) => setEscalationReason(e.target.value)}
              rows={2}
              placeholder="Why does this need escalation?"
              className="input-field mb-2"
            />
            <button
              onClick={() => {
                if (!escalationReason.trim()) return setError('An escalation reason is required.');
                if (window.confirm('Escalate this review to an administrator?')) {
                  runAction(() => reviewService.escalateReview(id, escalationReason), 'Escalated.');
                }
              }}
              disabled={busy}
              className="btn-secondary"
            >
              Escalate
            </button>
          </div>
        </div>
      )}

      {/* Operator: submit information */}
      {canSubmitInfo && (
        <div className="card p-4 mb-6">
          <p className="font-semibold text-slate-900 mb-2 text-sm">The reviewer requested more information</p>
          <p className="text-sm text-slate-600 mb-3">{review.informationRequest}</p>
          <textarea value={infoText} onChange={(e) => setInfoText(e.target.value)} rows={3} className="input-field mb-2" />
          <button
            onClick={() => {
              if (!infoText.trim()) return setError('Please enter the requested information.');
              runAction(() => reviewService.submitInformation(id, infoText), 'Information submitted.');
            }}
            disabled={busy}
            className="btn-primary"
          >
            Submit Information
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div className="card p-4">
          <p className="font-semibold text-slate-900 mb-3 text-sm">Review History</p>
          <ol className="space-y-2 text-xs">
            {history.map((a) => (
              <li key={a._id} className="flex gap-3">
                <span className="text-slate-400 w-32 shrink-0">{new Date(a.createdAt).toLocaleString()}</span>
                <span className="text-slate-700">
                  <span className="font-medium text-slate-900">{a.actionType}</span>
                  {a.comment && <> — {a.comment}</>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
