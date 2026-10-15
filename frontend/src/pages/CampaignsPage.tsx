import { useState, useEffect } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Chip } from '../components/Chip';
import { SidePanel } from '../components/SidePanel';
import {
  fetchCampaigns, fetchCampaign, createCampaign, decideCampaignItem,
  fetchBusinessUnits, fetchUsers,
} from '../api';
import type { Campaign, CampaignDetail, CampaignItem, BusinessUnit, User } from '../api';

function decisionColor(d: string | null): 'green' | 'red' | 'amber' | 'gray' {
  if (d === 'approved') return 'green';
  if (d === 'revoked') return 'red';
  if (d === 'reassigned') return 'amber';
  return 'gray';
}

function campaignStatusColor(s: string): 'blue' | 'green' | 'gray' {
  if (s === 'active') return 'blue';
  if (s === 'completed') return 'green';
  return 'gray';
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function ProgressBar({ total, pending }: { total: number; pending: number }) {
  const pct = total > 0 ? Math.round(((total - pending) / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-2 bg-indigo-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500">{total - pending}/{total}</span>
    </div>
  );
}

function DecisionButtons({
  item,
  users,
  onDecide,
}: {
  item: CampaignItem;
  users: User[];
  onDecide: (serial: string, decision: 'approved' | 'revoked' | 'reassigned', newOwner?: User) => void;
}) {
  const [reassigning, setReassigning] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');

  if (item.decision !== null) {
    return (
      <div className="flex items-center gap-2">
        <Chip label={item.decision.charAt(0).toUpperCase() + item.decision.slice(1)} color={decisionColor(item.decision)} />
        {item.new_owner && <span className="text-xs text-gray-500">→ {item.new_owner}</span>}
      </div>
    );
  }

  if (reassigning) {
    const selectedUser = users.find(u => u.id === selectedUserId) ?? null;
    return (
      <div className="flex items-center gap-2">
        <select
          value={selectedUserId}
          onChange={e => setSelectedUserId(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">Select user...</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <button
          disabled={!selectedUser}
          onClick={() => { if (selectedUser) { onDecide(item.serial_number, 'reassigned', selectedUser); setReassigning(false); } }}
          className="px-2 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-40"
        >
          Confirm
        </button>
        <button
          onClick={() => { setReassigning(false); setSelectedUserId(''); }}
          className="px-2 py-1 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-1.5">
      <button
        onClick={() => onDecide(item.serial_number, 'approved')}
        className="px-2.5 py-1 text-xs border border-green-300 text-green-700 rounded hover:bg-green-50"
      >
        Approve
      </button>
      <button
        onClick={() => onDecide(item.serial_number, 'revoked')}
        className="px-2.5 py-1 text-xs border border-red-300 text-red-700 rounded hover:bg-red-50"
      >
        Revoke
      </button>
      <button
        onClick={() => setReassigning(true)}
        className="px-2.5 py-1 text-xs border border-amber-300 text-amber-700 rounded hover:bg-amber-50"
      >
        Reassign
      </button>
    </div>
  );
}

export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [bus, setBus] = useState<BusinessUnit[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBuId, setNewBuId] = useState('');
  const [newDeadline, setNewDeadline] = useState('');
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState('');

  useEffect(() => {
    Promise.all([fetchCampaigns(), fetchBusinessUnits(), fetchUsers()])
      .then(([c, b, u]) => { setCampaigns(c); setBus(b); setUsers(u); })
      .finally(() => setLoading(false));
  }, []);

  async function openCampaign(c: Campaign) {
    const d = await fetchCampaign(c.id);
    setDetail(d);
  }

  async function handleDecide(
    serial: string,
    decision: 'approved' | 'revoked' | 'reassigned',
    newUser?: User,
  ) {
    if (!detail) return;
    try {
      const updated = await decideCampaignItem(
        detail.id, serial, decision,
        newUser?.name, newUser?.email,
      );
      setDetail(prev => {
        if (!prev) return prev;
        const items = prev.items.map((i: CampaignItem) => i.serial_number === serial ? updated : i);
        return {
          ...prev,
          items,
          approved:   items.filter((i: CampaignItem) => i.decision === 'approved').length,
          revoked:    items.filter((i: CampaignItem) => i.decision === 'revoked').length,
          reassigned: items.filter((i: CampaignItem) => i.decision === 'reassigned').length,
          pending:    items.filter((i: CampaignItem) => i.decision === null).length,
        };
      });
    } catch { /* silent */ }
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateMsg('');
    try {
      const result = await createCampaign(newName.trim(), newBuId || undefined, newDeadline || undefined);
      setCreateMsg(`Created with ${result.item_count} certificates.`);
      const refreshed = await fetchCampaigns();
      setCampaigns(refreshed);
      setNewName(''); setNewBuId(''); setNewDeadline('');
      setTimeout(() => { setShowNew(false); setCreateMsg(''); }, 1500);
    } catch {
      setCreateMsg('Failed to create campaign.');
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="text-center py-16 text-gray-400">Loading...</div>;

  // Detail view
  if (detail) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-1">
          <button onClick={() => setDetail(null)} className="text-sm text-gray-400 hover:text-gray-600">
            ← Campaigns
          </button>
        </div>
        <PageHeader
          title={detail.name}
          subtitle={`Created ${formatDate(detail.created_at)}${detail.deadline ? ` · Due ${formatDate(detail.deadline)}` : ''}`}
        />

        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-gray-500">{detail.total} certs</span>
          <Chip label={`${detail.approved} Approved`} color="green" />
          <Chip label={`${detail.revoked} Revoked`} color="red" />
          <Chip label={`${detail.reassigned} Reassigned`} color="amber" />
          <Chip label={`${detail.pending} Pending`} color="gray" />
          <div className="flex-1 mx-2 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-2 bg-indigo-600 rounded-full transition-all"
              style={{ width: `${detail.total > 0 ? Math.round(((detail.total - detail.pending) / detail.total) * 100) : 0}%` }}
            />
          </div>
          <Chip label={detail.status.charAt(0).toUpperCase() + detail.status.slice(1)} color={campaignStatusColor(detail.status)} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Common Name</th>
                <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">BU</th>
                <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Owner</th>
                <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Expires</th>
                <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Decision</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map(item => (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="px-4 py-3 font-medium text-gray-900">{item.common_name ?? item.serial_number}</td>
                  <td className="px-4 py-3 text-gray-600">{item.bu_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{item.owner || <span className="text-gray-400 italic text-xs">Unassigned</span>}</td>
                  <td className="px-4 py-3 text-gray-600">{item.valid_to || '—'}</td>
                  <td className="px-4 py-3">
                    <DecisionButtons item={item} users={users} onDecide={handleDecide} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <PageHeader title="Access Review Campaigns" subtitle="Periodic certification of certificate ownership and necessity." />
        <button
          onClick={() => setShowNew(true)}
          className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          New Campaign
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Name</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Scope</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Created</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Deadline</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Progress</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  No campaigns yet. Create one to get started.
                </td>
              </tr>
            ) : campaigns.map(c => {
              const scopeBu = bus.find(b => b.id === c.scope_bu_id);
              return (
                <tr
                  key={c.id}
                  onClick={() => openCampaign(c)}
                  className="border-b border-gray-100 cursor-pointer hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3 text-gray-600">{scopeBu?.name ?? 'All BUs'}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(c.created_at)}</td>
                  <td className="px-4 py-3 text-gray-600">{c.deadline ? formatDate(c.deadline) : '—'}</td>
                  <td className="px-4 py-3"><ProgressBar total={c.total} pending={c.pending} /></td>
                  <td className="px-4 py-3">
                    <Chip label={c.status.charAt(0).toUpperCase() + c.status.slice(1)} color={campaignStatusColor(c.status)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showNew && (
        <SidePanel
          title="New Campaign"
          onClose={() => { setShowNew(false); setCreateMsg(''); }}
          footer={
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {creating ? 'Creating...' : 'Create Campaign'}
            </button>
          }
        >
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Campaign Name *</label>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Q4 2026 NHI Review"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Scope — Business Unit</label>
              <select
                value={newBuId}
                onChange={e => setNewBuId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All Business Units</option>
                {bus.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Deadline (optional)</label>
              <input
                type="date"
                value={newDeadline}
                onChange={e => setNewDeadline(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {createMsg && (
              <p className={`text-sm ${createMsg.startsWith('Failed') ? 'text-red-600' : 'text-green-700'}`}>
                {createMsg}
              </p>
            )}
          </div>
        </SidePanel>
      )}
    </div>
  );
}
