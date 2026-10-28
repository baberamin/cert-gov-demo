import { useState, useEffect } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Chip } from '../components/Chip';
import { SidePanel } from '../components/SidePanel';
import {
  fetchExceptions, fetchAutoHandled, fetchRules, fetchUsers,
  decideException, updateRule, previewRule,
} from '../api';
import type { ExceptionItem, Recommendation, Rule, RulePreview, User } from '../api';

type Tab = 'queue' | 'auto' | 'rules';

const TH = 'text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide';

function ExceptionActions({ item, users, onDecide }: {
  item: ExceptionItem;
  users: User[];
  onDecide: (serial: string, decision: 'approved' | 'revoked' | 'reassigned', owner?: User) => void;
}) {
  const rec = item.recommendation;
  const suggested = users.find(u => u.name === rec?.owner?.name);
  const ordered = [...users].sort((a, b) => Number(b.department === rec?.team) - Number(a.department === rec?.team));
  const [reassigning, setReassigning] = useState(false);
  const [userId, setUserId] = useState(suggested?.id ?? '');
  const picked = users.find(u => u.id === userId);

  if (reassigning) {
    return (
      <div className="flex items-center gap-2">
        <select value={userId} onChange={e => setUserId(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500">
          <option value="">Select user...</option>
          {ordered.map(u => <option key={u.id} value={u.id}>{u.name} ({u.department})</option>)}
        </select>
        <button disabled={!picked}
          onClick={() => picked && onDecide(item.serial_number, 'reassigned', picked)}
          className="px-2 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-40">Confirm</button>
        <button onClick={() => { setReassigning(false); setUserId(''); }}
          className="px-2 py-1 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50">Cancel</button>
      </div>
    );
  }
  return (
    <div className="flex gap-1.5">
      <button onClick={() => onDecide(item.serial_number, 'approved')}
        className="px-2.5 py-1 text-xs border border-green-300 text-green-700 rounded hover:bg-green-50">Approve</button>
      <button onClick={() => onDecide(item.serial_number, 'revoked')}
        className="px-2.5 py-1 text-xs border border-red-300 text-red-700 rounded hover:bg-red-50">Revoke</button>
      <button onClick={() => setReassigning(true)}
        className="px-2.5 py-1 text-xs border border-amber-300 text-amber-700 rounded hover:bg-amber-50">Reassign</button>
    </div>
  );
}

const CONFIDENCE_COLOR = { High: 'green', Medium: 'amber', Low: 'gray', None: 'gray' } as const;

function RecommendationCell({ rec, users, onAccept }: {
  rec: Recommendation | null;
  users: User[];
  onAccept: (user: User) => void;
}) {
  if (!rec) return <span className="text-xs text-gray-400">—</span>;
  const user = users.find(u => u.name === rec.owner?.name);
  return (
    <div className="text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <Chip label={rec.confidence === 'None' ? 'No recommendation' : `${rec.confidence} confidence`} color={CONFIDENCE_COLOR[rec.confidence]} />
        {rec.owner && <span className="font-medium text-gray-900 text-sm">{rec.owner.name}</span>}
        {!rec.owner && rec.team && <span className="text-gray-700">Team: {rec.team}</span>}
      </div>
      {rec.owner && user && (
        <button onClick={() => onAccept(user)}
          className="mt-1.5 px-2 py-0.5 border border-indigo-300 text-indigo-700 rounded hover:bg-indigo-50">
          Accept suggestion
        </button>
      )}
      <details className="mt-1.5 text-gray-500">
        <summary className="cursor-pointer hover:text-gray-700">Evidence</summary>
        <ul className="mt-1 list-disc pl-4 space-y-0.5">
          {rec.evidence.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      </details>
    </div>
  );
}

function RuleEditor({ rule, onClose, onSaved }: { rule: Rule; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(rule.params).map(([k, v]) => [k, String(v)])),
  );
  const [enabled, setEnabled] = useState(rule.enabled);
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function edit() {
    const params: Record<string, number> = {};
    for (const [k, v] of Object.entries(values)) {
      const n = Number(v);
      if (v.trim() === '' || !Number.isInteger(n) || n < 0) throw new Error('Values must be whole numbers, 0 or more.');
      params[k] = n;
    }
    return { params, enabled };
  }

  async function run(action: 'preview' | 'save') {
    setError('');
    setBusy(true);
    try {
      const body = edit();
      if (action === 'preview') setPreview(await previewRule(rule.id, body));
      else { await updateRule(rule.id, body); onSaved(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  function changed() { setPreview(null); }

  return (
    <SidePanel title="Edit Rule" onClose={onClose} footer={
      <>
        <button onClick={() => run('preview')} disabled={busy}
          className="flex-1 px-4 py-2 text-sm border border-indigo-300 text-indigo-700 rounded-lg hover:bg-indigo-50 disabled:opacity-40">
          {busy ? 'Working...' : 'Preview impact'}
        </button>
        <button onClick={() => run('save')} disabled={busy}
          className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40">
          Save rule
        </button>
      </>
    }>
      <h2 className="text-base font-semibold text-gray-900 mb-1">{rule.name}</h2>
      <p className="text-sm text-gray-600 mb-4">{rule.description}</p>
      <div className="space-y-4">
        {Object.entries(rule.param_labels).map(([key, label]) => (
          <div key={key}>
            <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
            <input value={values[key] ?? ''} inputMode="numeric"
              onChange={e => { setValues(v => ({ ...v, [key]: e.target.value })); changed(); }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        ))}
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); changed(); }} />
          Rule enabled
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {preview && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm">
            <p className="font-medium text-gray-900 mb-1">Impact if saved</p>
            <p className="text-gray-700">
              <span className="font-semibold">{preview.to_queue}</span> more certificate{preview.to_queue === 1 ? '' : 's'} would need review
              {' · '}
              <span className="font-semibold">{preview.to_auto_approved}</span> more would be auto-approved
            </p>
            {preview.samples.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-gray-600">
                {preview.samples.map(s => (
                  <li key={s.serial_number}>
                    <span className="font-medium">{s.common_name ?? s.serial_number}</span>
                    {' → '}{s.to === 'needs_review' ? 'needs review' : 'auto-approved'}
                  </li>
                ))}
              </ul>
            )}
            {preview.to_queue === 0 && preview.to_auto_approved === 0 && (
              <p className="mt-1 text-xs text-gray-500">No certificates would change.</p>
            )}
          </div>
        )}
      </div>
    </SidePanel>
  );
}

function summarize(rule: Rule) {
  const p = rule.params;
  if (rule.template === 'unowned') return 'No owner in DigiCert or local store';
  if (rule.template === 'policy_violation') return `Key < ${p.min_key_size} bits, or validity > ${p.max_validity_days} days`;
  return `Owned, key ≥ ${p.min_key_size} bits, validity ≤ ${p.max_validity_days} days, ≥ ${p.min_days_to_expiry} days to expiry`;
}

export function ExceptionsPage() {
  const [tab, setTab] = useState<Tab>('queue');
  const [queue, setQueue] = useState<ExceptionItem[]>([]);
  const [auto, setAuto] = useState<ExceptionItem[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    const [q, a, r] = await Promise.all([fetchExceptions(), fetchAutoHandled(), fetchRules()]);
    setQueue(q); setAuto(a); setRules(r);
  }

  useEffect(() => {
    Promise.all([load(), fetchUsers().then(setUsers)])
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleDecide(serial: string, decision: 'approved' | 'revoked' | 'reassigned', owner?: User) {
    setError('');
    try {
      await decideException(serial, decision, owner?.name, owner?.email);
      setQueue(prev => prev.filter(i => i.serial_number !== serial));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decision failed.');
    }
  }

  async function handleSaved() {
    setEditing(null);
    setLoading(true);
    try {
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed.');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="text-center py-16 text-gray-400">Evaluating certificates...</div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'queue', label: `Needs Attention (${queue.length})` },
    { key: 'auto', label: `Auto-handled (${auto.length})` },
    { key: 'rules', label: 'Rules' },
  ];

  const certCells = (i: ExceptionItem) => (
    <>
      <td className="px-4 py-3 font-medium text-gray-900">{i.common_name ?? i.serial_number}</td>
      <td className="px-4 py-3 text-gray-600">{i.bu_name || '—'}</td>
      <td className="px-4 py-3 text-gray-600">{i.owner || <span className="text-gray-400 italic text-xs">Unassigned</span>}</td>
      <td className="px-4 py-3 text-gray-600">{i.valid_to || '—'}</td>
    </>
  );

  return (
    <div>
      <PageHeader title="Exceptions" subtitle="Certificates are approved automatically by rule. Only exceptions need a person." />

      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 transition-colors ${
              tab === t.key ? 'border-indigo-600 text-indigo-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {tab === 'queue' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-visible">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 bg-gray-50">
              <th className={TH}>Common Name</th><th className={TH}>BU</th><th className={TH}>Owner</th>
              <th className={TH}>Expires</th><th className={TH}>Why it needs you</th><th className={TH}>Suggested owner</th><th className={TH}>Decision</th>
            </tr></thead>
            <tbody>
              {queue.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Nothing needs attention.</td></tr>
              ) : queue.map(i => (
                <tr key={i.serial_number} className="border-b border-gray-100">
                  {certCells(i)}
                  <td className="px-4 py-3">
                    <Chip label={i.rule_name ?? 'No rule matched'} color={i.rule_name ? 'amber' : 'gray'} />
                    <p className="text-xs text-gray-500 mt-1">{i.reason}</p>
                  </td>
                  <td className="px-4 py-3">
                    <RecommendationCell rec={i.recommendation} users={users}
                      onAccept={u => handleDecide(i.serial_number, 'reassigned', u)} />
                  </td>
                  <td className="px-4 py-3"><ExceptionActions item={i} users={users} onDecide={handleDecide} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'auto' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 bg-gray-50">
              <th className={TH}>Common Name</th><th className={TH}>BU</th><th className={TH}>Owner</th>
              <th className={TH}>Expires</th><th className={TH}>Approved by rule</th><th className={TH}>Why</th>
            </tr></thead>
            <tbody>
              {auto.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Nothing was auto-handled.</td></tr>
              ) : auto.map(i => (
                <tr key={i.serial_number} className="border-b border-gray-100">
                  {certCells(i)}
                  <td className="px-4 py-3">
                    <button onClick={() => setEditing(rules.find(r => r.id === i.rule_id) ?? null)}
                      title="View or edit this rule" className="hover:opacity-80">
                      <Chip label={i.rule_name ?? 'Unknown rule'} color="green" />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{i.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'rules' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-200 bg-gray-50">
              <th className={TH}>Order</th><th className={TH}>Rule</th><th className={TH}>Action</th>
              <th className={TH}>Condition</th><th className={TH}>Status</th><th className={TH}></th>
            </tr></thead>
            <tbody>
              {rules.map((r, idx) => (
                <tr key={r.id} className="border-b border-gray-100">
                  <td className="px-4 py-3 text-gray-500">{idx + 1}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                  <td className="px-4 py-3">
                    <Chip label={r.outcome === 'auto_approve' ? 'Auto-approve' : 'Needs review'} color={r.outcome === 'auto_approve' ? 'green' : 'amber'} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">{summarize(r)}</td>
                  <td className="px-4 py-3"><Chip label={r.enabled ? 'Enabled' : 'Disabled'} color={r.enabled ? 'blue' : 'gray'} /></td>
                  <td className="px-4 py-3">
                    <button onClick={() => setEditing(r)}
                      className="px-2.5 py-1 text-xs border border-gray-300 text-gray-700 rounded hover:bg-gray-50">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-gray-500 border-t border-gray-100">
            Rules run top to bottom and the first match wins. A certificate no rule approves goes to Needs Attention.
          </p>
        </div>
      )}

      {editing && <RuleEditor key={editing.id} rule={editing} onClose={() => setEditing(null)} onSaved={handleSaved} />}
    </div>
  );
}
