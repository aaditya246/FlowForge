import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import * as workflowService from '../services/workflowService';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage } from '../utils/apiError';

export default function WorkflowsPage() {
  const { user } = useAuth();
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', description: '' });
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setWorkflows(await workflowService.listWorkflows());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      await workflowService.createWorkflow(form);
      setForm({ name: '', slug: '', description: '' });
      setShowCreate(false);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Workflows</h1>
        {user?.role === 'admin' && (
          <button onClick={() => setShowCreate((v) => !v)} className="btn-primary">
            <Plus size={16} /> New Workflow
          </button>
        )}
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="card mb-6 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-text">Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-field" />
            </div>
            <div>
              <label className="label-text">Slug</label>
              <input
                required
                pattern="[a-z0-9-]+"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                className="input-field"
              />
            </div>
          </div>
          <div>
            <label className="label-text">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input-field"
              rows={2}
            />
          </div>
          <button type="submit" disabled={creating} className="btn-primary">
            {creating ? 'Creating...' : 'Create'}
          </button>
        </form>
      )}

      {error && <p className="field-error-text mb-4">{error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : workflows.length === 0 ? (
        <p className="text-sm text-slate-500">No workflows yet.</p>
      ) : (
        <div className="card divide-y divide-slate-100">
          {workflows.map((wf) => (
            <Link key={wf._id} to={`/workflows/${wf._id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
              <div>
                <p className="text-sm font-medium text-slate-900">{wf.name}</p>
                <p className="text-xs text-slate-500">{wf.slug}</p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-slate-500">v{wf.currentPublishedVersion || '—'} published</span>
                <span className={wf.status === 'active' ? 'badge-success' : 'badge-neutral'}>{wf.status}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
