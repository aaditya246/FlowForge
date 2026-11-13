import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as workflowService from '../services/workflowService';
import * as requestService from '../services/requestService';
import { getErrorMessage } from '../utils/apiError';

function defaultValueFor(field) {
  if (field.type === 'boolean') return false;
  if (field.type === 'number') return '';
  if (field.type === 'array') return '';
  return '';
}

function FieldInput({ field, value, onChange }) {
  if (field.enum && field.enum.length > 0) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-field">
        <option value="">Select...</option>
        {field.enum.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === 'boolean') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-field">
        <option value="">Select...</option>
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    );
  }

  if (field.type === 'array') {
    return (
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Comma-separated values" className="input-field" />
    );
  }

  return (
    <input
      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      min={field.min}
      max={field.max}
      className="input-field"
    />
  );
}

function coerceValue(field, raw) {
  if (raw === '') return undefined;
  if (field.type === 'number') return Number(raw);
  if (field.type === 'boolean') return raw === 'true';
  if (field.type === 'array') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return raw;
}

export default function RequestSubmissionPage() {
  const [workflows, setWorkflows] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [version, setVersion] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    workflowService
      .listWorkflows()
      .then((all) => setWorkflows(all.filter((w) => w.status === 'active' && w.currentPublishedVersion > 0)))
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setVersion(null);
    setFormValues({});
    setResult(null);
    setFieldErrors([]);
    if (!selectedId) return;
    const workflow = workflows.find((w) => w._id === selectedId);
    if (!workflow) return;
    workflowService
      .getVersion(selectedId, workflow.currentPublishedVersion)
      .then((v) => {
        setVersion(v);
        const initial = {};
        (v.inputSchema || []).forEach((f) => {
          initial[f.name] = defaultValueFor(f);
        });
        setFormValues(initial);
      })
      .catch((err) => setError(getErrorMessage(err)));
  }, [selectedId, workflows]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setFieldErrors([]);
    setResult(null);
    setSubmitting(true);
    try {
      const payload = {};
      (version.inputSchema || []).forEach((f) => {
        const coerced = coerceValue(f, formValues[f.name]);
        if (coerced !== undefined) payload[f.name] = coerced;
      });
      const res = await requestService.submitRequest({ workflowId: selectedId, payload });
      setResult(res);
      if (!res.valid) setFieldErrors(res.errors || []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const selectedWorkflow = workflows.find((w) => w._id === selectedId);

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Submit Request</h1>
      <p className="text-sm text-slate-500 mb-6">
        Pick a published workflow — the form below is generated entirely from its input schema.
      </p>

      {loading ? (
        <p className="text-sm text-slate-500">Loading workflows...</p>
      ) : workflows.length === 0 ? (
        <p className="text-sm text-slate-500">No published workflows available yet.</p>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="label-text">Workflow</label>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="input-field">
              <option value="">Select a workflow...</option>
              {workflows.map((w) => (
                <option key={w._id} value={w._id}>
                  {w.name} (v{w.currentPublishedVersion})
                </option>
              ))}
            </select>
            {selectedWorkflow?.description && <p className="text-xs text-slate-500 mt-1">{selectedWorkflow.description}</p>}
          </div>

          {version && (
            <form onSubmit={handleSubmit} className="card space-y-3 p-4">
              {(version.inputSchema || []).length === 0 ? (
                <p className="text-sm text-slate-500">This workflow has no configured input fields.</p>
              ) : (
                version.inputSchema.map((field) => (
                  <div key={field.name}>
                    <label className="label-text">
                      {field.name}
                      {field.required && <span className="text-red-500"> *</span>}
                    </label>
                    <FieldInput
                      field={field}
                      value={formValues[field.name] ?? ''}
                      onChange={(v) => setFormValues((prev) => ({ ...prev, [field.name]: v }))}
                    />
                  </div>
                ))
              )}
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? 'Submitting...' : 'Submit Request'}
              </button>
            </form>
          )}
        </div>
      )}

      {error && <p className="field-error-text mt-4">{error}</p>}

      {fieldErrors.length > 0 && (
        <div className="mt-4 rounded-lg bg-red-50 text-red-700 p-3 text-sm">
          <p className="font-medium mb-1">Validation failed:</p>
          <ul className="list-disc list-inside space-y-0.5">
            {fieldErrors.map((e, i) => (
              <li key={i}>{e.message || JSON.stringify(e)}</li>
            ))}
          </ul>
        </div>
      )}

      {result?.valid && result.execution && (
        <div className="mt-4 rounded-lg bg-green-50 text-green-700 p-3 text-sm">
          <p>
            Execution state: <span className="font-semibold">{result.execution.currentState}</span>
            {result.execution.finalDecision && (
              <>
                {' '}
                &mdash; decision: <span className="font-semibold">{result.execution.finalDecision}</span>
              </>
            )}
          </p>
          <Link to={`/executions/${result.execution._id}`} className="underline font-medium">
            View execution details &rarr;
          </Link>
        </div>
      )}
    </div>
  );
}
