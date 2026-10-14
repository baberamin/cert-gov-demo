import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Chip } from '../components/Chip';
import { SidePanel } from '../components/SidePanel';
import { FINDINGS } from '../mockData';
import type { Finding } from '../mockData';

function severityColor(s: string): 'red' | 'amber' | 'blue' | 'gray' {
  if (s === 'critical') return 'red';
  if (s === 'high') return 'amber';
  if (s === 'medium') return 'blue';
  return 'gray';
}

function statusColor(s: string): 'red' | 'amber' | 'green' | 'gray' {
  if (s === 'open') return 'red';
  if (s === 'in-review') return 'amber';
  if (s === 'resolved') return 'green';
  return 'gray';
}

function statusLabel(s: string) {
  const map: Record<string, string> = { open: 'Open', 'in-review': 'In Review', resolved: 'Resolved' };
  return map[s] ?? s;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const ALL = '';
const CATEGORIES = Array.from(new Set(FINDINGS.map(f => f.category))).sort();
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const STATUSES = ['open', 'in-review', 'resolved'];

export function FindingsPage() {
  const [catFilter, setCatFilter] = useState(ALL);
  const [sevFilter, setSevFilter] = useState(ALL);
  const [stFilter, setStFilter] = useState(ALL);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [localStatus, setLocalStatus] = useState<Record<string, Finding['status']>>({});

  function getStatus(f: Finding): Finding['status'] {
    return localStatus[f.id] ?? f.status;
  }

  const filtered = FINDINGS.filter(f => {
    if (catFilter && f.category !== catFilter) return false;
    if (sevFilter && f.severity !== sevFilter) return false;
    if (stFilter && getStatus(f) !== stFilter) return false;
    return true;
  });

  function markInReview(id: string) {
    setLocalStatus(prev => ({ ...prev, [id]: 'in-review' }));
    if (selected?.id === id) setSelected(f => f ? { ...f, status: 'in-review' } : f);
  }

  function markResolved(id: string) {
    setLocalStatus(prev => ({ ...prev, [id]: 'resolved' }));
    if (selected?.id === id) setSelected(f => f ? { ...f, status: 'resolved' } : f);
  }

  const selectedStatus = selected ? getStatus(selected) : null;

  const panelFooter = selected ? (
    <>
      {selectedStatus === 'open' && (
        <button
          onClick={() => markInReview(selected.id)}
          className="flex-1 px-4 py-2 text-sm border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 transition-colors"
        >
          Mark In Review
        </button>
      )}
      {(selectedStatus === 'open' || selectedStatus === 'in-review') && (
        <button
          onClick={() => markResolved(selected.id)}
          className="flex-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
        >
          Mark Resolved
        </button>
      )}
      {selectedStatus === 'resolved' && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset text-green-700 bg-green-50 ring-green-200">
          Resolved
        </span>
      )}
    </>
  ) : undefined;

  return (
    <div>
      <PageHeader title="Findings" subtitle="Security findings from certificate posture analysis." />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={catFilter}
          onChange={e => setCatFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <select
          value={sevFilter}
          onChange={e => setSevFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Severities</option>
          {SEVERITIES.map(s => <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>

        <select
          value={stFilter}
          onChange={e => setStFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Finding</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Category</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Severity</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Affected</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Detected</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">No findings match filters.</td>
              </tr>
            ) : filtered.map(f => {
              const st = getStatus(f);
              const isSelected = selected?.id === f.id;
              return (
                <tr
                  key={f.id}
                  onClick={() => setSelected({ ...f, status: st })}
                  className={`border-b border-gray-100 cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{f.title}</td>
                  <td className="px-4 py-3 text-gray-600">{f.category}</td>
                  <td className="px-4 py-3"><Chip label={f.severity.charAt(0).toUpperCase() + f.severity.slice(1)} color={severityColor(f.severity)} /></td>
                  <td className="px-4 py-3 text-gray-600">{f.affectedAsset}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(f.detectedOn)}</td>
                  <td className="px-4 py-3"><Chip label={statusLabel(st)} color={statusColor(st)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Detail panel */}
      {selected && (
        <SidePanel title="Finding Detail" onClose={() => setSelected(null)} footer={panelFooter}>
          <div className="mb-4">
            <h2 className="text-base font-semibold text-gray-900 mb-1">{selected.title}</h2>
            <div className="flex gap-2 mt-2">
              <Chip label={selected.severity.charAt(0).toUpperCase() + selected.severity.slice(1)} color={severityColor(selected.severity)} />
              <Chip label={statusLabel(selectedStatus!)} color={statusColor(selectedStatus!)} />
            </div>
          </div>

          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs text-gray-400 mb-1">Description</p>
              <p className="text-gray-700">{selected.description}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Category</p>
              <p className="text-gray-700">{selected.category}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Affected Asset</p>
              <p className="text-gray-700">{selected.affectedAsset}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Affected Count</p>
              <p className="text-gray-700">{selected.affectedCount}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Detected On</p>
              <p className="text-gray-700">{formatDate(selected.detectedOn)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Remediation Steps</p>
              <p className="text-gray-700">{selected.remediationSteps}</p>
            </div>
          </div>
        </SidePanel>
      )}
    </div>
  );
}
