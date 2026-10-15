import { useState, useEffect } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Chip } from '../components/Chip';
import { SidePanel } from '../components/SidePanel';
import { fetchFindings, updateFindingStatus, revoke } from '../api';
import type { Finding } from '../api';

const FINDING_LABELS: Record<string, string> = {
  expiring_soon:  'Certificate Expiring Soon',
  unowned:        'Unowned Certificate',
  weak_key:       'Weak Key Size',
  long_lived:     'Long-Lived Certificate',
  quantum_unsafe: 'Quantum-Unsafe Algorithm',
};

const FINDING_CATEGORIES: Record<string, string> = {
  expiring_soon:  'Expiry Risk',
  unowned:        'Ownership',
  weak_key:       'Key Compliance',
  long_lived:     'Expiry Risk',
  quantum_unsafe: 'Quantum Safety',
};

const FINDING_REMEDIATION: Record<string, string> = {
  expiring_soon:  'Revoke and reissue the certificate to extend its validity period.',
  unowned:        'Assign an owner via the Certificate Inventory Assign Owner action.',
  weak_key:       'Revoke and reissue with a minimum 2048-bit RSA or 256-bit EC key.',
  long_lived:     'Consider revoking and reissuing with a validity period ≤ 365 days.',
  quantum_unsafe: 'Plan migration to a quantum-safe algorithm when available in the profile.',
};

const TYPE_OPTIONS = Object.entries(FINDING_LABELS).map(([value, label]) => ({ value, label }));
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const STATUSES = ['open', 'in-review', 'resolved'];
const ALL = '';

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
  return ({ open: 'Open', 'in-review': 'In Review', resolved: 'Resolved' } as Record<string, string>)[s] ?? s;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function FindingsPage() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [sevFilter, setSevFilter] = useState(ALL);
  const [stFilter, setStFilter] = useState(ALL);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [revokeMsg, setRevokeMsg] = useState('');

  useEffect(() => {
    fetchFindings().then(setFindings).finally(() => setLoading(false));
  }, []);

  async function markStatus(id: string, status: Finding['status']) {
    try {
      const updated = await updateFindingStatus(id, status);
      setFindings(prev => prev.map(f => f.id === id ? updated : f));
      if (selected?.id === id) setSelected(updated);
    } catch { /* silent */ }
  }

  async function handleRevoke(serial: string) {
    setRevokeMsg('Revoking...');
    try {
      await revoke(serial, 'KEY_COMPROMISE');
      setRevokeMsg('Revoked. Refresh page to update findings.');
    } catch {
      setRevokeMsg('Revoke failed.');
    }
  }

  const filtered = findings.filter(f => {
    if (typeFilter && f.finding_type !== typeFilter) return false;
    if (sevFilter && f.severity !== sevFilter) return false;
    if (stFilter && f.status !== stFilter) return false;
    return true;
  });

  const panelFooter = selected ? (
    <>
      {selected.status === 'open' && (
        <button
          onClick={() => markStatus(selected.id, 'in-review')}
          className="flex-1 px-4 py-2 text-sm border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 transition-colors"
        >
          Mark In Review
        </button>
      )}
      {(selected.status === 'open' || selected.status === 'in-review') && (
        <button
          onClick={() => markStatus(selected.id, 'resolved')}
          className="flex-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
        >
          Mark Resolved
        </button>
      )}
      {selected.status === 'resolved' && <Chip label="Resolved" color="green" />}
    </>
  ) : undefined;

  if (loading) return <div className="text-center py-16 text-gray-400">Loading findings...</div>;

  return (
    <div>
      <PageHeader title="Findings" subtitle="Security findings from certificate posture analysis." />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">All Types</option>
          {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={sevFilter} onChange={e => setSevFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">All Severities</option>
          {SEVERITIES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <select value={stFilter} onChange={e => setStFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Finding</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Category</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Severity</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Affected Cert</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Detected</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">No findings match filters.</td>
              </tr>
            ) : filtered.map(f => (
              <tr key={f.id} onClick={() => { setSelected(f); setRevokeMsg(''); }}
                className={`border-b border-gray-100 cursor-pointer transition-colors ${selected?.id === f.id ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                <td className="px-4 py-3 font-medium text-gray-900">{FINDING_LABELS[f.finding_type] ?? f.finding_type}</td>
                <td className="px-4 py-3 text-gray-600">{FINDING_CATEGORIES[f.finding_type] ?? '—'}</td>
                <td className="px-4 py-3"><Chip label={f.severity.charAt(0).toUpperCase() + f.severity.slice(1)} color={severityColor(f.severity)} /></td>
                <td className="px-4 py-3 text-gray-600">{f.common_name ?? f.serial_number}</td>
                <td className="px-4 py-3 text-gray-600">{formatDate(f.created_at)}</td>
                <td className="px-4 py-3"><Chip label={statusLabel(f.status)} color={statusColor(f.status)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <SidePanel title="Finding Detail" onClose={() => setSelected(null)} footer={panelFooter}>
          <div className="mb-4">
            <h2 className="text-base font-semibold text-gray-900 mb-1">{FINDING_LABELS[selected.finding_type] ?? selected.finding_type}</h2>
            <div className="flex gap-2 mt-2">
              <Chip label={selected.severity.charAt(0).toUpperCase() + selected.severity.slice(1)} color={severityColor(selected.severity)} />
              <Chip label={statusLabel(selected.status)} color={statusColor(selected.status)} />
            </div>
          </div>
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs text-gray-400 mb-1">Description</p>
              <p className="text-gray-700">{selected.detail}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Category</p>
              <p className="text-gray-700">{FINDING_CATEGORIES[selected.finding_type] ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Affected Certificate</p>
              <p className="text-gray-700">{selected.common_name ?? selected.serial_number}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Detected</p>
              <p className="text-gray-700">{formatDate(selected.created_at)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Remediation</p>
              <p className="text-gray-700">{FINDING_REMEDIATION[selected.finding_type] ?? 'Review and take appropriate action.'}</p>
            </div>
            <div className="pt-2 border-t border-gray-100">
              <a href="/inventory" className="text-sm text-indigo-600 hover:text-indigo-800">
                View in Inventory →
              </a>
            </div>
            {(selected.finding_type === 'expiring_soon' || selected.finding_type === 'weak_key') && selected.status !== 'resolved' && (
              <div>
                <button
                  onClick={() => handleRevoke(selected.serial_number)}
                  className="w-full px-4 py-2 text-sm border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors"
                >
                  Revoke Certificate
                </button>
                {revokeMsg && <p className="text-xs text-gray-500 mt-1 text-center">{revokeMsg}</p>}
              </div>
            )}
          </div>
        </SidePanel>
      )}
    </div>
  );
}
