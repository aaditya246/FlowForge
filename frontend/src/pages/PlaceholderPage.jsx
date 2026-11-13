export default function PlaceholderPage({ title, phase }) {
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-2">{title}</h1>
      <p className="text-sm text-slate-500">This screen is built out in {phase}.</p>
    </div>
  );
}
