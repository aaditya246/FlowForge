import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Workflow } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/ui/PasswordInput';
import { getErrorMessage } from '../utils/apiError';

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function validate() {
    const errors = {};
    if (!name.trim()) errors.name = 'Name is required';
    if (!isValidEmail(email)) errors.email = 'Enter a valid email address';
    if (password.length < 8) errors.password = 'Password must be at least 8 characters';
    if (confirmPassword !== password) errors.confirmPassword = 'Passwords do not match';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!validate()) return;

    setSubmitting(true);
    try {
      // No `role` is sent — the backend assigns its permitted public default
      // (operator). Self-registering as admin is intentionally not possible.
      await register({ name: name.trim(), email: email.trim(), password });
      navigate('/dashboard');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
            <Workflow size={18} className="text-white" />
          </div>
          <span className="text-lg font-semibold text-slate-900">FlowForge</span>
        </div>

        <h2 className="text-xl font-semibold text-slate-900 mb-1">Create your account</h2>
        <p className="text-sm text-slate-500 mb-6">Get started submitting and tracking workflow requests.</p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label className="label-text" htmlFor="name">
              Full name
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              placeholder="Jane Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`input-field ${fieldErrors.name ? 'input-error' : ''}`}
            />
            {fieldErrors.name && <p className="field-error-text">{fieldErrors.name}</p>}
          </div>

          <div>
            <label className="label-text" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`input-field ${fieldErrors.email ? 'input-error' : ''}`}
            />
            {fieldErrors.email && <p className="field-error-text">{fieldErrors.email}</p>}
          </div>

          <div>
            <label className="label-text" htmlFor="password">
              Password
            </label>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={fieldErrors.password}
            />
            {fieldErrors.password && <p className="field-error-text">{fieldErrors.password}</p>}
          </div>

          <div>
            <label className="label-text" htmlFor="confirmPassword">
              Confirm password
            </label>
            <PasswordInput
              id="confirmPassword"
              autoComplete="new-password"
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              error={fieldErrors.confirmPassword}
            />
            {fieldErrors.confirmPassword && <p className="field-error-text">{fieldErrors.confirmPassword}</p>}
          </div>

          {error && <p className="field-error-text">{error}</p>}

          <button type="submit" disabled={submitting} className="btn-primary w-full py-2.5">
            {submitting ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className="text-sm text-slate-500 mt-6 text-center">
          Already have an account?{' '}
          <Link to="/login" className="text-brand-600 hover:text-brand-700 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
