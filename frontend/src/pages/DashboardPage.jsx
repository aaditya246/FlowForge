const stats = [
  { label: 'Total Requests', value: '--' },
  { label: 'Approved', value: '--' },
  { label: 'Rejected', value: '--' },
  { label: 'Manual Review', value: '--' },
];

export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-6">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-4">
            <p className="text-sm text-slate-500">{s.label}</p>
            <p className="text-2xl font-semibold text-slate-900 mt-1">{s.value}</p>
          </div>
        ))}
      </div>
      <p className="text-sm text-slate-500 mt-6">
        Live analytics wire up once request submission is producing real executions — see the Requests
        and Reliability pages for the real, working data.
      </p>
    </div>
  );
}
