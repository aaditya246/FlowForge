import { useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Workflow,
  SendHorizontal,
  ListChecks,
  ShieldCheck,
  FlaskConical,
  ActivitySquare,
  Siren,
  LogOut,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/workflows', label: 'Workflows', icon: Workflow },
  { to: '/rules/test', label: 'Rule Tester', icon: FlaskConical },
  { to: '/submit', label: 'Submit Request', icon: SendHorizontal },
  { to: '/requests', label: 'Requests', icon: ListChecks },
  { to: '/review', label: 'Manual Review', icon: ShieldCheck },
  { to: '/reliability', label: 'Reliability', icon: ActivitySquare, roles: ['admin', 'reviewer'] },
  { to: '/simulation', label: 'Failure Simulation', icon: Siren, roles: ['admin'] },
];

function pageTitleFor(pathname) {
  const match = [...navItems].sort((a, b) => b.to.length - a.to.length).find((item) => pathname.startsWith(item.to));
  if (match) return match.label;
  if (pathname.startsWith('/workflows/')) return 'Workflow Details';
  if (pathname.startsWith('/executions/')) return 'Execution Details';
  return 'FlowForge';
}

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-60 shrink-0 bg-sidebar flex flex-col">
        <div className="px-5 py-4 flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-brand-600 flex items-center justify-center shrink-0">
            <Workflow size={16} className="text-white" />
          </div>
          <span className="text-base font-semibold text-white">FlowForge</span>
        </div>

        <nav className="flex-1 px-2 space-y-0.5 mt-2">
          {navItems
            .filter((item) => !item.roles || item.roles.includes(user?.role))
            .map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive ? 'bg-brand-600 text-white' : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white'
                  }`
                }
              >
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
        </nav>

        <div className="p-3 border-t border-white/10">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-text hover:bg-sidebar-hover hover:text-white transition"
          >
            <LogOut size={16} />
            Log out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 bg-white border-b border-slate-200 flex items-center justify-between px-6">
          <h1 className="text-base font-semibold text-slate-900">{pageTitleFor(location.pathname)}</h1>

          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100 transition"
            >
              <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 text-xs font-semibold flex items-center justify-center">
                {user?.name?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-sm font-medium text-slate-900 leading-tight">{user?.name}</p>
                <p className="text-xs text-slate-500 leading-tight capitalize">{user?.role}</p>
              </div>
              <ChevronDown size={14} className="text-slate-400" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-1 w-48 card py-1 z-10">
                <div className="px-3 py-2 border-b border-slate-100">
                  <p className="text-sm font-medium text-slate-900 truncate">{user?.name}</p>
                  <p className="text-xs text-slate-500 truncate">{user?.email}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                >
                  <LogOut size={14} />
                  Log out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 p-6 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
