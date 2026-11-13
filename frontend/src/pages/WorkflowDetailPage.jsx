import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import * as workflowService from '../services/workflowService';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage } from '../utils/apiError';

export default function WorkflowDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [workflow, setWorkflow] = useState(null);
  const [versions, setVersions] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [creatingDraft, setCreatingDraft] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [wf, vs] = await Promise.all([workflowService.getWorkflow(id), workflowService.listVersions(id)]);
      setWorkflow(wf);
      setVersions(vs);
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

  async function handleCreateDraft(cloneFromVersion) {
    setCreatingDraft(true);
    setError('');
    try {
      const draft = await workflowService.createVersion(id, cloneFromVersion);
      navigate(`/workflows/${id}/versions/${draft.version}`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setCreatingDraft(false);
    }
  }

  async function handleArchive() {
    try {
      await workflowService.archiveWorkflow(id);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading...</p>;
  if (!workflow) return <p className="field-error-text">{error || 'Workflow not found'}</p>;

  const latestVersion = versions[0];

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{workflow.name}</h1>
          <p className="text-sm text-slate-500">{workflow.slug}</p>
          <p className="text-sm text-slate-500 mt-1">{workflow.description}</p>
        </div>
        {user?.role === 'admin' && (
          <div className="flex gap-2">
            <button onClick={() => handleCreateDraft(latestVersion?.version)} disabled={creatingDraft} className="btn-primary">
              {latestVersion ? 'New Draft (clone latest)' : 'Create First Draft'}
            </button>
            {workflow.status !== 'archived' && (
              <button onClick={handleArchive} className="btn-secondary">
                Archive
              </button>
            )}
          </div>
        )}
      </div>

      {error && <p className="field-error-text mb-4">{error}</p>}

      <h2 className="text-sm font-semibold text-slate-900 mb-2">Version History</h2>
      {versions.length === 0 ? (
        <p className="text-sm text-slate-500">No versions yet. Create a draft to get started.</p>
      ) : (
        <div className="card divide-y divide-slate-100">
          {versions.map((v) => (
            <Link key={v.version} to={`/workflows/${id}/versions/${v.version}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
              <div>
                <p className="text-sm font-medium text-slate-900">Version {v.version}</p>
                <p className="text-xs text-slate-500">
                  {v.stages?.length || 0} stages &middot; {v.rules?.length || 0} rules
                </p>
              </div>
              <span
                className={
                  v.status === 'published' ? 'badge-success' : v.status === 'draft' ? 'badge-warning' : 'badge-neutral'
                }
              >
                {v.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
