import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Workflow, ShieldCheck, GitBranch, Activity } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/ui/PasswordInput';
import { getErrorMessage } from '../utils/apiError';

const FEATURES = [
  { icon: GitBranch, text: 'Configurable, versioned workflows — no code changes to update a rule' },
  { icon: ShieldCheck, text: 'Every decision is explainable, with a full rule-evaluation trace' },
  { icon: Activity, text: 'Built-in reliability: retries, recovery, and idempotent execution' },
];

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password, { remember });
      navigate('/dashboard');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Left: brand panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-sidebar text-white flex-col justify-between p-12">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
            <Workflow size={18} />
          </div>
          <span className="text-lg font-semibold">FlowForge</span>
        </div>

        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight mb-4">
            Intelligent Workflow Decision Platform
          </h1>
          <p className="text-sidebar-text text-sm leading-relaxed mb-8">
            Configure workflows and business rules once, then let FlowForge run requests through them
            automatically — approving, rejecting, or routing to a human reviewer — with a fully
            explainable audit trail at every step.
          </p>
          <ul className="space-y-4">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-sidebar-text">
                <span className="mt-0.5 w-6 h-6 rounded-md bg-white/10 flex items-center justify-center shrink-0">
                  <Icon size={14} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-sidebar-muted">&copy; {new Date().getFullYear()} FlowForge</p>
      </div>

      {/* Right: login card */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8 justify-center">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
              <Workflow size={18} className="text-white" />
            </div>
            <span className="text-lg font-semibold text-slate-900">FlowForge</span>
          </div>

          <h2 className="text-xl font-semibold text-slate-900 mb-1">Sign in</h2>
          <p className="text-sm text-slate-500 mb-6">Welcome back — enter your credentials to continue.</p>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label className="label-text" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="label-text mb-0" htmlFor="password">
                  Password
                </label>
              </div>
              <PasswordInput
                id="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-600 select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              Remember me
            </label>

            {error && <p className="field-error-text">{error}</p>}

            <button type="submit" disabled={submitting} className="btn-primary w-full py-2.5">
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <p className="text-sm text-slate-500 mt-6 text-center">
            Don&apos;t have an account?{' '}
            <Link to="/register" className="text-brand-600 hover:text-brand-700 font-medium">
              Create account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
