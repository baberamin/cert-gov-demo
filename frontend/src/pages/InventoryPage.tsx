import { useState, useEffect, useRef } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Chip } from '../components/Chip';
import { SidePanel } from '../components/SidePanel';
import { fetchCertificates, fetchBusinessUnits, revoke, reissue, cancel, fetchOwnerAssignments, fetchBuAssignments, assignOwner, fetchUsers, syncBusinessUnits } from '../api';
import type { Cert, BusinessUnit, User } from '../api';

type PanelMode = 'detail' | 'revoke' | 'reissue' | 'cancel' | 'assign';

function isQuantumSafe(cert: Cert): boolean {
  return cert.quantum_safe ?? false;
}

function parseAttributes(cert: Cert): Record<string, unknown> {
  if (!cert.attributes) return {};
  try { return JSON.parse(cert.attributes) as Record<string, unknown>; } catch { return {}; }
}

function statusColor(s: string): 'green' | 'red' | 'gray' | 'amber' | 'blue' {
  if (s === 'issued' || s === 'active') return 'green';
  if (s === 'expired' || s === 'revoked') return 'red';
  if (s === 'pending') return 'amber';
  if (s === 'suspended') return 'blue';
  return 'gray';
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    issued: 'Active', active: 'Active', expired: 'Expired',
    revoked: 'Revoked', pending: 'Pending', suspended: 'Suspended',
    rejected: 'Rejected',
  };
  return map[s] ?? s;
}

function daysUntil(dateStr?: string) {
  if (!dateStr) return Infinity;
  return Math.floor((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function formatDate(dateStr?: string) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function ExpiryCell({ dateStr }: { dateStr?: string }) {
  const d = daysUntil(dateStr);
  const formatted = formatDate(dateStr);
  if (d <= 30 && d >= 0) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {formatted}
        <Chip label={`${d}d`} color="red" />
      </span>
    );
  }
  if (d < 0) return <span className="text-red-600">{formatted}</span>;
  return <>{formatted}</>;
}

interface ActionsDropdownProps {
  cert: Cert;
  hasOwner: boolean;
  onDetail: () => void;
  onRevoke: () => void;
  onReissue: () => void;
  onCancel: () => void;
  onAssign: () => void;
}

function ActionsDropdown({ cert, hasOwner, onDetail, onRevoke, onReissue, onCancel, onAssign }: ActionsDropdownProps) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick() { setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation();
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen(v => !v);
  }

  const isPending = cert.status === 'pending';
  const isActive = cert.status === 'issued' || cert.status === 'active';
  const canRevoke = isActive;
  const canReissue = isActive;
  const canCancel = isPending;

  return (
    <div>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700"
        aria-label="Actions"
      >
        ⋯
      </button>
      {open && (
        <div
          className="fixed w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1"
          style={{ top: menuPos.top, right: menuPos.right }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            onClick={() => { setOpen(false); onDetail(); }}
          >
            View Details
          </button>
          {!hasOwner && (
            <button
              className="w-full text-left px-4 py-2 text-sm text-indigo-600 hover:bg-indigo-50"
              onClick={() => { setOpen(false); onAssign(); }}
            >
              Assign Owner
            </button>
          )}
          {canRevoke && (
            <button
              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
              onClick={() => { setOpen(false); onRevoke(); }}
            >
              Revoke
            </button>
          )}
          {canReissue && (
            <button
              className="w-full text-left px-4 py-2 text-sm text-indigo-600 hover:bg-indigo-50"
              onClick={() => { setOpen(false); onReissue(); }}
            >
              Revoke &amp; Reissue
            </button>
          )}
          {canCancel && (
            <button
              className="w-full text-left px-4 py-2 text-sm text-amber-600 hover:bg-amber-50"
              onClick={() => { setOpen(false); onCancel(); }}
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DetailPanel({ cert, localBus, localOwner, users, onClose, onRevoke, onReissue, onOwnerSaved }: {
  cert: Cert;
  localBus: Record<string, { id: string; name: string }>;
  localOwner: string;
  users: User[];
  onClose: () => void;
  onRevoke: () => void;
  onReissue: () => void;
  onOwnerSaved: (serial: string, ownerName: string) => void;
}) {
  const [editingOwner, setEditingOwner] = useState(false);
  const [ownerQuery, setOwnerQuery] = useState('');
  const [ownerSelected, setOwnerSelected] = useState<User | null>(null);
  const [ownerDropOpen, setOwnerDropOpen] = useState(false);
  const [savingOwner, setSavingOwner] = useState(false);
  const [ownerError, setOwnerError] = useState('');
  const ownerDropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ownerDropRef.current && !ownerDropRef.current.contains(e.target as Node)) setOwnerDropOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const recommendation = getRecommendation(cert, users, localBus);
  const showOwnerPicker = !localOwner || editingOwner;

  const filteredOwners = users.filter(u =>
    !ownerQuery || u.name.toLowerCase().includes(ownerQuery.toLowerCase()) || u.email.toLowerCase().includes(ownerQuery.toLowerCase())
  );

  async function saveOwner(user: User) {
    setSavingOwner(true);
    setOwnerError('');
    try {
      await assignOwner(cert.serial_number, user.name, user.email, cert.seat?.seat_id);
      onOwnerSaved(cert.serial_number, user.name);
      setEditingOwner(false);
      setOwnerSelected(null);
      setOwnerQuery('');
    } catch (e) {
      setOwnerError(e instanceof Error ? e.message : 'Failed to save owner');
    } finally {
      setSavingOwner(false);
    }
  }

  const sans = cert.san?.dns_names ?? [];
  const isActive = cert.status === 'issued' || cert.status === 'active';

  const footer = isActive ? (
    <>
      <button onClick={onRevoke} className="flex-1 px-4 py-2 text-sm border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors">
        Revoke
      </button>
      <button onClick={onReissue} className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
        Revoke &amp; Reissue
      </button>
    </>
  ) : undefined;

  const attrs = parseAttributes(cert);
  const keyAlgorithm = attrs.public_key_algorithm as string | undefined;
  const keyLength = attrs.key_length as number | undefined;
  const keyUsage = attrs.key_usage as string[] | undefined;
  const authorityKeyId = attrs.authority_key_identifier as string | undefined;
  const subjectKeyId = attrs.subject_key_identifier as string | undefined;

  return (
    <SidePanel title="Certificate Detail" onClose={onClose} footer={footer}>

      <section className="mb-5">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Identity</h3>
        <div className="space-y-2.5">
          <div>
            <p className="text-xs text-gray-400">Common Name</p>
            <p className="text-sm font-medium text-gray-900">{cert.common_name ?? cert.seat?.seat_id ?? '—'}</p>
          </div>
          {sans.length > 0 && (
            <div>
              <p className="text-xs text-gray-400">SANs</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {sans.map(s => <Chip key={s} label={s} color="gray" />)}
              </div>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-400">Serial Number</p>
            <p className="text-xs font-mono text-gray-600 break-all">{cert.serial_number}</p>
          </div>
          {cert.thumbprint && (
            <div>
              <p className="text-xs text-gray-400">Thumbprint</p>
              <p className="text-xs font-mono text-gray-600 break-all">{cert.thumbprint}</p>
            </div>
          )}
        </div>
      </section>

      {cert.subject?.organization_name && (
        <section className="mb-5">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Subject</h3>
          <div className="space-y-2.5">
            <div>
              <p className="text-xs text-gray-400">Organization</p>
              <p className="text-sm text-gray-700">{cert.subject.organization_name}</p>
            </div>
            {cert.subject.organization_units && cert.subject.organization_units.length > 0 && (
              <div>
                <p className="text-xs text-gray-400">Organizational Unit</p>
                <p className="text-sm text-gray-700">{cert.subject.organization_units.join(', ')}</p>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="mb-5">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Public Key</h3>
        <div className="space-y-2.5">
          {keyAlgorithm && (
            <div>
              <p className="text-xs text-gray-400">Key Algorithm</p>
              <p className="text-sm text-gray-700">{keyAlgorithm}</p>
            </div>
          )}
          {keyLength && (
            <div>
              <p className="text-xs text-gray-400">Key Length</p>
              <p className="text-sm text-gray-700">{keyLength} bits</p>
            </div>
          )}
          {cert.signature_algorithm && (
            <div>
              <p className="text-xs text-gray-400">Signature Algorithm</p>
              <p className="text-sm font-mono text-gray-700">{cert.signature_algorithm}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-400">Escrowed</p>
            <p className="text-sm text-gray-700">{cert.escrow ? 'Yes' : 'No'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Quantum Safe</p>
            {cert.quantum_safe
              ? <span className="text-sm font-medium text-green-700">Yes</span>
              : <span className="text-sm text-gray-500">No</span>}
          </div>
        </div>
      </section>

      <section className="mb-5">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Extensions</h3>
        <div className="space-y-2.5">
          {keyUsage && keyUsage.length > 0 && (
            <div>
              <p className="text-xs text-gray-400">Key Usage</p>
              <p className="text-sm text-gray-700">{keyUsage.map(k => k.replace(/_/g, ' ')).join(', ')}</p>
            </div>
          )}
          {cert.extended_key_usage && (
            <div>
              <p className="text-xs text-gray-400">Extended Key Usage</p>
              <p className="text-sm text-gray-700">{cert.extended_key_usage}</p>
            </div>
          )}
          {authorityKeyId && (
            <div>
              <p className="text-xs text-gray-400">Authority Key Identifier</p>
              <p className="text-xs font-mono text-gray-600 break-all">{authorityKeyId}</p>
            </div>
          )}
          {subjectKeyId && (
            <div>
              <p className="text-xs text-gray-400">Subject Key Identifier</p>
              <p className="text-xs font-mono text-gray-600 break-all">{subjectKeyId}</p>
            </div>
          )}
        </div>
      </section>

      <section className="mb-5">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Ownership</h3>
        <div className="space-y-2.5 mb-3">
          <div>
            <p className="text-xs text-gray-400">Business Unit</p>
            <p className="text-sm text-gray-700">{(localBus[cert.serial_number] ?? cert.business_unit)?.name ?? '—'}</p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400">Owner</p>
              <p className="text-sm text-gray-700">{localOwner || '—'}</p>
            </div>
            {localOwner && !editingOwner && (
              <button
                onClick={() => setEditingOwner(true)}
                className="text-xs text-indigo-600 hover:text-indigo-800"
              >
                Change
              </button>
            )}
          </div>
          {cert.ca_vendor && (
            <div>
              <p className="text-xs text-gray-400">CA Vendor</p>
              <p className="text-sm text-gray-700">{cert.ca_vendor}</p>
            </div>
          )}
          {cert.issuing_ca_name && (
            <div>
              <p className="text-xs text-gray-400">Issuing CA</p>
              <p className="text-sm text-gray-700">{cert.issuing_ca_name}</p>
            </div>
          )}
        </div>

        {/* Inline owner assignment / change */}
        {showOwnerPicker && (
          <div className="border-t border-gray-100 pt-3 space-y-3">
            {/* Recommendation */}
            {recommendation && !editingOwner && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Recommended Owner</p>
                <div className="border border-gray-200 rounded-lg px-3 py-2.5 bg-white">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-sm font-medium text-gray-900">{recommendation.user.name}</p>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${scoreChipClass(recommendation.score)}`}>
                      {recommendation.score}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mb-2">{recommendation.user.email} · {recommendation.user.department}</p>
                  <button
                    onClick={() => saveOwner(recommendation.user)}
                    disabled={savingOwner}
                    className="w-full px-3 py-1.5 text-sm border border-indigo-300 text-indigo-700 rounded-lg hover:bg-indigo-50 disabled:opacity-40 transition-colors"
                  >
                    {savingOwner ? 'Saving…' : 'Accept Recommendation'}
                  </button>
                </div>
              </div>
            )}

            {/* Picker */}
            <div>
              {recommendation && !editingOwner && (
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-xs text-gray-400">or choose manually</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
              )}
              {editingOwner && (
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Change Owner</p>
              )}
              <div ref={ownerDropRef} className="relative">
                <input
                  type="text"
                  value={ownerSelected && !ownerDropOpen ? ownerSelected.name : ownerQuery}
                  onChange={e => { setOwnerQuery(e.target.value); setOwnerSelected(null); setOwnerDropOpen(true); }}
                  onFocus={() => setOwnerDropOpen(true)}
                  placeholder="Search by name or email…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {ownerDropOpen && (
                  <div className="absolute left-0 right-0 bottom-full mb-1 bg-white border border-gray-200 rounded-lg shadow-lg z-40 max-h-44 overflow-y-auto">
                    {filteredOwners.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-gray-400">No users found.</p>
                    ) : filteredOwners.map(u => (
                      <button
                        key={u.id}
                        className="w-full text-left px-4 py-2 hover:bg-indigo-50 transition-colors border-b border-gray-50 last:border-0"
                        onClick={() => { setOwnerSelected(u); setOwnerQuery(''); setOwnerDropOpen(false); }}
                      >
                        <p className="text-sm font-medium text-gray-900">{u.name}</p>
                        <p className="text-xs text-gray-400">{u.email} · {u.department}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {ownerSelected && (
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => saveOwner(ownerSelected)}
                    disabled={savingOwner}
                    className="flex-1 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                  >
                    {savingOwner ? 'Saving…' : 'Assign Owner'}
                  </button>
                  {editingOwner && (
                    <button
                      onClick={() => { setEditingOwner(false); setOwnerSelected(null); setOwnerQuery(''); }}
                      className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              )}
            </div>

            {ownerError && (
              <p className="text-xs text-red-600">{ownerError}</p>
            )}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Lifecycle</h3>
        <div className="space-y-2.5">
          <div>
            <p className="text-xs text-gray-400">Valid From</p>
            <p className="text-sm text-gray-700">{formatDate(cert.valid_from)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Valid To</p>
            <p className="text-sm text-gray-700">{formatDate(cert.valid_to)}</p>
          </div>
          {cert.expires_in_days !== undefined && (
            <div>
              <p className="text-xs text-gray-400">Expires In</p>
              <p className={`text-sm font-medium ${cert.expires_in_days <= 30 ? 'text-red-600' : 'text-gray-700'}`}>
                {cert.expires_in_days} days
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-400">Status</p>
            <Chip label={statusLabel(cert.status)} color={statusColor(cert.status)} />
          </div>
        </div>
      </section>
    </SidePanel>
  );
}

const REVOCATION_REASONS: { value: string; label: string }[] = [
  { value: 'UNSPECIFIED',            label: 'Unspecified' },
  { value: 'KEY_COMPROMISE',         label: 'Key Compromise' },
  { value: 'CA_COMPROMISE',          label: 'CA Compromise' },
  { value: 'AFFILIATION_CHANGED',    label: 'Affiliation Changed' },
  { value: 'SUPERSEDED',             label: 'Superseded' },
  { value: 'CESSATION_OF_OPERATION', label: 'Cessation of Operation' },
  { value: 'CERTIFICATE_HOLD',       label: 'Certificate Hold' },
  { value: 'REMOVE_FROM_CRL',        label: 'Remove from CRL' },
  { value: 'PRIVILEGE_WITHDRAWN',    label: 'Privilege Withdrawn' },
  { value: 'AA_COMPROMISE',          label: 'AA Compromise' },
];

function ActionPanel({ cert, mode, onClose, onSuccess }: {
  cert: Cert;
  mode: 'revoke' | 'reissue' | 'cancel';
  onClose: () => void;
  onSuccess: (serial: string, update: Partial<Cert>) => void;
}) {
  const [reason, setReason] = useState('UNSPECIFIED');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const bannerConfig = {
    revoke:  { bg: 'bg-red-50 border-red-200 text-red-700', text: 'Revoking is immediate and irreversible.' },
    reissue: { bg: 'bg-blue-50 border-blue-200 text-blue-700', text: 'A fresh key pair will be generated. The old certificate will be revoked as superseded.' },
    cancel:  { bg: 'bg-amber-50 border-amber-200 text-amber-700', text: 'This will halt the pending issuance request.' },
  }[mode];

  const titles = { revoke: 'Revoke Certificate', reissue: 'Revoke & Reissue', cancel: 'Cancel Order' };

  async function handleSubmit() {
    setLoading(true);
    setError('');
    try {
      if (mode === 'revoke') {
        await revoke(cert.serial_number, reason);
        onSuccess(cert.serial_number, { status: 'revoked' });
      } else if (mode === 'reissue') {
        await reissue(cert.serial_number);
        onSuccess(cert.serial_number, { status: 'revoked' });
      } else {
        await cancel(cert.serial_number);
        onSuccess(cert.serial_number, { status: 'rejected' });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  const submitBtn = {
    revoke: (
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="flex-1 px-4 py-2 text-sm border border-red-300 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-40 transition-colors"
      >
        {loading ? 'Working…' : 'Revoke Certificate'}
      </button>
    ),
    reissue: (
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
      >
        {loading ? 'Working…' : 'Revoke & Reissue'}
      </button>
    ),
    cancel: (
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="flex-1 px-4 py-2 text-sm border border-red-300 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-40 transition-colors"
      >
        {loading ? 'Working…' : 'Cancel Order'}
      </button>
    ),
  }[mode];

  const footer = (
    <>
      {submitBtn}
      <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors">
        Cancel
      </button>
    </>
  );

  return (
    <SidePanel title={titles[mode]} onClose={onClose} footer={footer}>
      <div className={`border rounded-lg px-4 py-3 text-sm mb-5 ${bannerConfig.bg}`}>
        {bannerConfig.text}
      </div>

      <div className="mb-4">
        <label className="block text-xs text-gray-500 mb-1">Certificate</label>
        <p className="text-sm font-medium text-gray-900">{cert.common_name ?? cert.seat?.seat_id ?? '—'}</p>
      </div>

      {mode === 'revoke' && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">
            Revocation Reason <span className="text-red-500">*</span>
          </label>
          <select
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {REVOCATION_REASONS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <div className="mt-4 border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
    </SidePanel>
  );
}

function isExternalCert(cert: Cert): boolean {
  return !cert.ica || cert.ica.id === 'EXTERNAL_CA';
}

type RecommendationScore = 'High' | 'Medium' | 'Low';

function getRecommendation(cert: Cert, users: User[], localBus: Record<string, { id: string; name: string }>): { user: User; score: RecommendationScore } | null {
  if (!users.length) return null;

  // Deterministic index from serial so same cert always gets same recommendation
  const hash = cert.serial_number.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const buName = (localBus[cert.serial_number] ?? cert.business_unit)?.name ?? '';

  // BU names are long-form ("DevOps & Infrastructure") while user departments are short ("DevOps")
  // so match if the BU name contains the department name as a substring
  const deptUsers = users.filter(u => buName && buName.toLowerCase().includes(u.department.toLowerCase()));
  const adjacentDepts: Record<string, string[]> = {
    Engineering: ['DevOps'],
    DevOps: ['Engineering'],
    Finance: ['Legal'],
    Legal: ['Finance'],
    Marketing: ['Finance'],
  };
  const buKey = Object.keys(adjacentDepts).find(k => buName.toLowerCase().includes(k.toLowerCase())) ?? '';
  const adjacentUsers = users.filter(u => (adjacentDepts[buKey] ?? []).includes(u.department));

  let score: RecommendationScore;
  let pool: User[];
  if (deptUsers.length) {
    pool = deptUsers;
    score = 'High';
  } else if (adjacentUsers.length) {
    pool = adjacentUsers;
    score = 'Medium';
  } else {
    pool = users;
    score = 'Low';
  }

  return { user: pool[hash % pool.length], score };
}

function scoreChipClass(score: RecommendationScore) {
  if (score === 'High') return 'text-green-700 bg-green-50 ring-green-200';
  if (score === 'Medium') return 'text-amber-700 bg-amber-50 ring-amber-200';
  return 'text-gray-500 bg-gray-100 ring-gray-200';
}

function AssignOwnerPanel({ cert, users, localBus, onClose, onSuccess }: {
  cert: Cert;
  users: User[];
  localBus: Record<string, { id: string; name: string }>;
  onClose: () => void;
  onSuccess: (serial: string, ownerName: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<User | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const external = isExternalCert(cert);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const recommendation = getRecommendation(cert, users, localBus);

  const filtered = users.filter(u =>
    !query || u.name.toLowerCase().includes(query.toLowerCase()) || u.email.toLowerCase().includes(query.toLowerCase())
  );

  async function submit(user: User) {
    setLoading(true);
    setError('');
    try {
      await assignOwner(cert.serial_number, user.name, user.email, cert.seat?.seat_id);
      onSuccess(cert.serial_number, user.name);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  const footer = (
    <>
      <button
        onClick={() => selected && submit(selected)}
        disabled={loading || !selected}
        className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
      >
        {loading ? 'Saving…' : 'Assign Owner'}
      </button>
      <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors">
        Cancel
      </button>
    </>
  );

  return (
    <SidePanel title="Assign Owner" onClose={onClose} footer={footer}>

      {/* Origin notice */}
      {external ? (
        <div className="bg-gray-50 border border-gray-200 text-gray-600 text-xs px-3 py-2 rounded-lg mb-4">
          External / discovered cert — ownership tracked locally only.
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-2 rounded-lg mb-4">
          CA-issued cert — local save now, DigiCert write-back pending API confirmation.
        </div>
      )}

      {/* Certificate label */}
      <div className="mb-5">
        <p className="text-xs text-gray-400">Certificate</p>
        <p className="text-sm font-medium text-gray-900">{cert.common_name ?? cert.seat?.seat_id ?? '—'}</p>
      </div>

      {/* Recommendation */}
      {recommendation && (
        <div className="mb-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Recommended Owner</p>
          <div className="border border-gray-200 rounded-lg px-4 py-3 bg-white">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-gray-900">{recommendation.user.name}</p>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${scoreChipClass(recommendation.score)}`}>
                {recommendation.score} confidence
              </span>
            </div>
            <p className="text-xs text-gray-400 mb-1">{recommendation.user.email}</p>
            <p className="text-xs text-gray-400 mb-3">{recommendation.user.department}</p>
            <button
              onClick={() => submit(recommendation.user)}
              disabled={loading}
              className="w-full px-3 py-1.5 text-sm border border-indigo-300 text-indigo-700 rounded-lg hover:bg-indigo-50 disabled:opacity-40 transition-colors"
            >
              Accept Recommendation
            </button>
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-px bg-gray-200" />
        <span className="text-xs text-gray-400">or choose manually</span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>

      {/* Searchable dropdown */}
      <div ref={dropdownRef} className="relative">
        <input
          type="text"
          value={selected && !dropdownOpen ? selected.name : query}
          onChange={e => { setQuery(e.target.value); setSelected(null); setDropdownOpen(true); }}
          onFocus={() => setDropdownOpen(true)}
          placeholder="Search by name or email…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {dropdownOpen && (
          <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-40 max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-400">No users found.</p>
            ) : filtered.map(u => (
              <button
                key={u.id}
                className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 transition-colors border-b border-gray-50 last:border-0"
                onClick={() => { setSelected(u); setQuery(''); setDropdownOpen(false); }}
              >
                <p className="text-sm font-medium text-gray-900">{u.name}</p>
                <p className="text-xs text-gray-400">{u.email} · {u.department}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="mt-2 flex items-center gap-2 text-sm text-indigo-700">
          <span>Selected:</span>
          <span className="font-medium">{selected.name}</span>
          <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 ml-auto text-xs">✕</button>
        </div>
      )}

      {error && (
        <div className="mt-4 border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
    </SidePanel>
  );
}

interface IssueResult {
  serial_number?: string;
  common_name?: string | null;
  status?: string;
  valid_from?: string;
  valid_to?: string;
  private_key?: string;
  error?: string;
}

function IssueCertPanel({ bus, users, onClose, onIssued }: {
  bus: BusinessUnit[];
  users: User[];
  onClose: () => void;
  onIssued: (cert: Cert, owner?: User) => void;
}) {
  const [commonName, setCommonName] = useState('');
  const [seatId, setSeatId] = useState('');
  const [seatIdEdited, setSeatIdEdited] = useState(false);
  const [dnsNamesRaw, setDnsNamesRaw] = useState('');
  const [selectedBuId, setSelectedBuId] = useState('');
  const [selectedOwner, setSelectedOwner] = useState<User | null>(null);
  const [ownerQuery, setOwnerQuery] = useState('');
  const [ownerDropOpen, setOwnerDropOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<IssueResult | null>(null);
  const [showKey, setShowKey] = useState(false);
  const ownerDropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ownerDropRef.current && !ownerDropRef.current.contains(e.target as Node)) setOwnerDropOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const today = new Date();
  const validFromStr = today.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const validToDate = new Date(today);
  validToDate.setDate(today.getDate() + 199);
  const validToStr = validToDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  const filteredOwners = users.filter(u =>
    !ownerQuery || u.name.toLowerCase().includes(ownerQuery.toLowerCase()) || u.email.toLowerCase().includes(ownerQuery.toLowerCase())
  );

  async function handleSubmit() {
    const cn = commonName.trim();
    if (!cn) return;
    const effectiveSeatId = seatId.trim() || cn;
    const dns_names = dnsNamesRaw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (!dns_names.length) dns_names.push(cn);
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/certificates/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          common_name: cn,
          dns_names,
          seat_id: effectiveSeatId,
          ...(selectedBuId && { business_unit_id: selectedBuId }),
        }),
      });
      const data: IssueResult = await res.json();
      if (!res.ok) {
        setError(data.error ?? JSON.stringify(data));
      } else {
        setResult(data);
        if (data.serial_number) {
          const selectedBu = bus.find(b => b.id === selectedBuId);
          const certForState: Cert = {
            ...(data as unknown as Cert),
            serial_number: data.serial_number,
            common_name: data.common_name ?? null,
            status: data.status ?? 'issued',
            valid_from: data.valid_from ?? '',
            valid_to: data.valid_to ?? '',
            seat: { seat_id: effectiveSeatId },
            business_unit: selectedBu,
          };
          onIssued(certForState, selectedOwner ?? undefined);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  if (result && !result.error) {
    const doneFooter = (
      <button onClick={onClose} className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
        Done
      </button>
    );
    return (
      <SidePanel title="Certificate Issued" onClose={onClose} footer={doneFooter}>
        <div className="flex items-center gap-2 mb-5">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset text-green-700 bg-green-50 ring-green-200">
            Issued
          </span>
          <p className="text-sm font-semibold text-gray-900">{result.common_name ?? commonName}</p>
        </div>
        <div className="space-y-3 mb-5">
          <div>
            <p className="text-xs text-gray-400">Serial Number</p>
            <p className="text-xs font-mono text-gray-600 break-all">{result.serial_number ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Status</p>
            <p className="text-sm text-gray-700 capitalize">{result.status ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Valid From</p>
            <p className="text-sm text-gray-700">{formatDate(result.valid_from)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Valid To</p>
            <p className="text-sm text-gray-700">{formatDate(result.valid_to)}</p>
          </div>
          {selectedOwner && (
            <div>
              <p className="text-xs text-gray-400">Owner</p>
              <p className="text-sm text-gray-700">{selectedOwner.name}</p>
            </div>
          )}
        </div>
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Private Key</p>
            <button onClick={() => setShowKey(v => !v)} className="text-xs text-indigo-600 hover:text-indigo-800">
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          {showKey ? (
            <pre className="text-xs font-mono bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all text-gray-700">
              {result.private_key}
            </pre>
          ) : (
            <p className="text-xs text-gray-400">Store the private key securely — it is not persisted by this application.</p>
          )}
        </div>
      </SidePanel>
    );
  }

  const issueFooter = (
    <>
      <button
        onClick={handleSubmit}
        disabled={loading || !commonName.trim()}
        className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
      >
        {loading ? 'Generating keypair & enrolling…' : 'Issue Certificate'}
      </button>
      <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors">
        Cancel
      </button>
    </>
  );

  return (
    <SidePanel title="Issue Certificate" onClose={onClose} footer={issueFooter}>
      <div className="text-xs text-gray-500 mb-5 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 space-y-1">
        <p><span className="font-medium text-gray-700">Profile:</span> Private Server Certificate 199 Days</p>
        <p><span className="font-medium text-gray-700">Issuing CA:</span> Saviynt Test ICA → Saviynt Test Root CA</p>
        <p><span className="font-medium text-gray-700">Key:</span> RSA 2048 · SHA-256 · 199-day validity</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">
            Common Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={commonName}
            onChange={e => {
              setCommonName(e.target.value);
              if (!seatIdEdited) setSeatId(e.target.value);
            }}
            placeholder="e.g. myservice.acme.com"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">
            Seat ID
            <span className="text-gray-400 ml-1">(defaults to Common Name — reuses an existing DigiCert seat)</span>
          </label>
          <input
            type="text"
            value={seatId}
            onChange={e => { setSeatId(e.target.value); setSeatIdEdited(true); }}
            placeholder={commonName.trim() || 'Defaults to Common Name'}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">
            SAN DNS Names
            <span className="text-gray-400 ml-1">(comma or newline — defaults to CN)</span>
          </label>
          <textarea
            value={dnsNamesRaw}
            onChange={e => setDnsNamesRaw(e.target.value)}
            rows={2}
            placeholder="myservice.acme.com, www.myservice.acme.com"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Business Unit</label>
          <select
            value={selectedBuId}
            onChange={e => setSelectedBuId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">— None —</option>
            {bus.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Owner <span className="text-gray-400">(optional)</span></label>
          <div ref={ownerDropRef} className="relative">
            <input
              type="text"
              value={selectedOwner && !ownerDropOpen ? selectedOwner.name : ownerQuery}
              onChange={e => { setOwnerQuery(e.target.value); setSelectedOwner(null); setOwnerDropOpen(true); }}
              onFocus={() => setOwnerDropOpen(true)}
              placeholder="Search by name or email…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {ownerDropOpen && (
              <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-40 max-h-44 overflow-y-auto">
                {filteredOwners.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-gray-400">No users found.</p>
                ) : filteredOwners.map(u => (
                  <button
                    key={u.id}
                    className="w-full text-left px-4 py-2 hover:bg-indigo-50 transition-colors border-b border-gray-50 last:border-0"
                    onClick={() => { setSelectedOwner(u); setOwnerQuery(''); setOwnerDropOpen(false); }}
                  >
                    <p className="text-sm font-medium text-gray-900">{u.name}</p>
                    <p className="text-xs text-gray-400">{u.email} · {u.department}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedOwner && (
            <div className="mt-1.5 flex items-center gap-2 text-sm text-indigo-700">
              <span className="font-medium">{selectedOwner.name}</span>
              <button onClick={() => setSelectedOwner(null)} className="text-gray-400 hover:text-gray-600 ml-auto text-xs">✕</button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Valid From</label>
            <p className="text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 bg-gray-50">{validFromStr}</p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Valid To</label>
            <p className="text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 bg-gray-50">{validToStr}</p>
          </div>
        </div>
        <p className="text-xs text-gray-400 -mt-2">Validity is fixed at 199 days by the certificate profile.</p>
      </div>

      {error && (
        <div className="mt-4 border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
    </SidePanel>
  );
}

const PAGE_SIZE_OPTIONS = [20, 50, 100];
const ALL = '';

export function InventoryPage() {
  const [certs, setCerts] = useState<Cert[]>([]);
  const [bus, setBus] = useState<BusinessUnit[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [localOwners, setLocalOwners] = useState<Record<string, string>>({});
  const [localBus, setLocalBus] = useState<Record<string, { id: string; name: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [issueOpen, setIssueOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [buFilter, setBuFilter] = useState(ALL);
  const [caFilter, setCaFilter] = useState(ALL);
  const [ownerFilter, setOwnerFilter] = useState(ALL);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [selected, setSelected] = useState<Cert | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>('detail');

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Promise.all([fetchCertificates(), fetchBusinessUnits(), fetchOwnerAssignments(), fetchBuAssignments(), fetchUsers()])
      .then(([c, b, owners, buAssignments, u]) => {
        setCerts(c); setBus(b); setLocalOwners(owners); setLocalBus(buAssignments); setUsers(u);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Merge newly found certs into the list without replacing existing ones
  function mergeCerts(found: Cert[]) {
    setCerts(prev => {
      const existing = new Set(prev.map(c => c.serial_number));
      const toAdd = found.filter(c => !existing.has(c.serial_number));
      return toAdd.length ? [...toAdd, ...prev] : prev;
    });
  }

  function handleSearchChange(val: string) {
    setSearch(val);
    setPage(1);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const trimmed = val.trim();
    if (trimmed.length < 2) return;
    searchTimer.current = setTimeout(() => {
      fetchCertificates({ seat_id: trimmed }).then(mergeCerts).catch(() => {});
    }, 500);
  }

  const statuses = Array.from(new Set(certs.map(c => c.status).filter(Boolean))).sort();

  function certCA(c: Cert) {
    return (c.ca_vendor ?? c.issuing_ca_name ?? c.ica?.name ?? c.issuer?.common_name ?? c.issuer?.organization ?? '').trim();
  }

  const caOptions = Array.from(new Set(certs.map(certCA).filter(Boolean))).sort();

  const ownerOptions = Array.from(new Set(
    certs.map(c => (c.seat?.seat_name ?? localOwners[c.serial_number] ?? '').trim()).filter(Boolean)
  )).sort();

  const filtered = certs.filter(c => {
    if (search) {
      const haystack = [
        c.common_name,
        c.seat?.seat_id,
        c.subject?.common_name,
        c.serial_number,
        ...(c.san?.dns_names ?? []),
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    if (statusFilter && c.status !== statusFilter) return false;
    if (buFilter) {
      const effectiveBuId = (localBus[c.serial_number] ?? c.business_unit)?.id;
      if (effectiveBuId !== buFilter) return false;
    }
    if (caFilter && certCA(c) !== caFilter) return false;
    if (ownerFilter) {
      const owner = (c.seat?.seat_name ?? localOwners[c.serial_number] ?? '').trim();
      if (owner !== ownerFilter) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const filtersActive = !!(search || statusFilter || buFilter || caFilter || ownerFilter);

  function clearFilters() {
    setSearch('');
    setStatusFilter(ALL);
    setBuFilter(ALL);
    setCaFilter(ALL);
    setOwnerFilter(ALL);
    setPage(1);
  }

  function openPanel(cert: Cert, mode: PanelMode) {
    setSelected(cert);
    setPanelMode(mode);
  }

  function handleSuccess(serial: string, update: Partial<Cert>) {
    setCerts(prev => prev.map(c => c.serial_number === serial ? { ...c, ...update } : c));
  }

  function handleAssignSuccess(serial: string, ownerName: string) {
    setLocalOwners(prev => ({ ...prev, [serial]: ownerName }));
  }

  function handleIssued(cert: Cert, owner?: User) {
    if (owner) {
      setLocalOwners(prev => ({ ...prev, [cert.serial_number]: owner.name }));
      assignOwner(cert.serial_number, owner.name, owner.email, cert.seat?.seat_id).catch(() => {});
    }
    // cert.business_unit was set to the selected BU by IssueCertPanel before calling onIssued
    if (cert.business_unit) {
      setLocalBus(prev => ({ ...prev, [cert.serial_number]: cert.business_unit! }));
    }
    setCerts(prev => [cert, ...prev.filter(c => c.serial_number !== cert.serial_number)]);
  }

  async function handleSyncBUs() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await syncBusinessUnits();
      const created = res.results.filter(r => r.status === 'created').map(r => r.name);
      const found = res.results.filter(r => r.status === 'found').map(r => r.name);
      const errors = res.results.filter(r => r.status === 'error').map(r => r.name);
      const parts = [];
      if (created.length) parts.push(`Created: ${created.join(', ')}`);
      if (found.length) parts.push(`Found: ${found.join(', ')}`);
      if (errors.length) parts.push(`Failed: ${errors.join(', ')}`);
      setSyncResult(parts.length ? parts.join(' · ') : 'All BUs up to date');
      // Refresh BU list
      const newBus = await fetchBusinessUnits();
      setBus(newBus);
    } catch (e) {
      setSyncResult(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return (
    <div>
      <PageHeader title="Certificate Inventory" subtitle="Certificates managed via DigiCert Trust Lifecycle Manager." />
      <div className="text-gray-400 text-sm">Loading certificates…</div>
    </div>
  );

  if (error) return (
    <div>
      <PageHeader title="Certificate Inventory" subtitle="Certificates managed via DigiCert Trust Lifecycle Manager." />
      <div className="text-red-600 text-sm">Error: {error}</div>
    </div>
  );

  return (
    <div>
      <PageHeader title="Certificate Inventory" subtitle="Certificates managed via DigiCert Trust Lifecycle Manager." />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="text"
          placeholder="Search by name or serial…"
          value={search}
          onChange={e => handleSearchChange(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-52"
        />

        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Statuses</option>
          {statuses.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>

        <select
          value={buFilter}
          onChange={e => { setBuFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Business Units</option>
          {bus.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        <select
          value={caFilter}
          onChange={e => { setCaFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All CAs</option>
          {caOptions.map(ca => <option key={ca} value={ca}>{ca}</option>)}
        </select>

        <select
          value={ownerFilter}
          onChange={e => { setOwnerFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Owners</option>
          {ownerOptions.map(o => <option key={o} value={o}>{o}</option>)}
        </select>

        {filtersActive && (
          <button onClick={clearFilters} className="text-sm text-indigo-600 hover:text-indigo-800 whitespace-nowrap">
            Clear filters
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleSyncBUs}
            disabled={syncing}
            title="Create/sync demo Business Units in DigiCert so BU assignment works"
            className="px-3 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            {syncing ? 'Syncing…' : 'Sync BUs'}
          </button>
          <button
            onClick={() => setIssueOpen(true)}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium whitespace-nowrap"
          >
            + Issue Certificate
          </button>
        </div>
      </div>
      {syncResult && (
        <p className="text-xs text-gray-500 mb-2">{syncResult}</p>
      )}

      {/* Range indicator */}
      <p className="text-xs text-gray-500 mb-3">
        {filtered.length === 0 ? 'No certificates' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filtered.length)} of ${filtered.length}`}
      </p>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Certificate Common Name</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">CA Vendor</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Business Unit</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Owner</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Status</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Valid To</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Valid From</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide">Quantum Safe</th>
              <th className="text-xs uppercase text-gray-500 px-4 py-3 text-left font-medium tracking-wide w-12"></th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-400 text-sm">No certificates found.</td>
              </tr>
            ) : paginated.map(cert => {
              const isSelected = selected?.serial_number === cert.serial_number;
              const owner = cert.seat?.seat_name ?? localOwners[cert.serial_number] ?? '';
              const effectiveBu = localBus[cert.serial_number] ?? cert.business_unit;
              const caVendor = cert.ca_vendor ?? cert.issuing_ca_name ?? cert.ica?.name ?? cert.issuer?.common_name ?? cert.issuer?.organization ?? '—';
              const quantumSafe = isQuantumSafe(cert);
              return (
                <tr
                  key={cert.serial_number}
                  onClick={() => openPanel(cert, 'detail')}
                  className={`border-b border-gray-100 cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{cert.common_name ?? cert.seat?.seat_id ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{caVendor}</td>
                  <td className="px-4 py-3 text-gray-600">{effectiveBu?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{owner}</td>
                  <td className="px-4 py-3">
                    <Chip label={statusLabel(cert.status)} color={statusColor(cert.status)} />
                  </td>
                  <td className="px-4 py-3 text-gray-600"><ExpiryCell dateStr={cert.valid_to} /></td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(cert.valid_from)}</td>
                  <td className="px-4 py-3">
                    {quantumSafe
                      ? <span className="text-green-700 font-medium">Yes</span>
                      : <span className="text-gray-400">No</span>}
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <ActionsDropdown
                      cert={cert}
                      hasOwner={!!owner}
                      onDetail={() => openPanel(cert, 'detail')}
                      onRevoke={() => openPanel(cert, 'revoke')}
                      onReissue={() => openPanel(cert, 'reissue')}
                      onCancel={() => openPanel(cert, 'cancel')}
                      onAssign={() => openPanel(cert, 'assign')}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span>Rows per page:</span>
          {PAGE_SIZE_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => { setPageSize(s); setPage(1); }}
              className={`px-2 py-0.5 rounded ${pageSize === s ? 'bg-indigo-600 text-white' : 'hover:bg-gray-100'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      </div>

      {/* Side panels */}
      {selected && panelMode === 'detail' && (
        <DetailPanel
          cert={selected}
          localBus={localBus}
          localOwner={selected.seat?.seat_name ?? localOwners[selected.serial_number] ?? ''}
          users={users}
          onClose={() => setSelected(null)}
          onRevoke={() => setPanelMode('revoke')}
          onReissue={() => setPanelMode('reissue')}
          onOwnerSaved={handleAssignSuccess}
        />
      )}
      {selected && (panelMode === 'revoke' || panelMode === 'reissue' || panelMode === 'cancel') && (
        <ActionPanel
          cert={selected}
          mode={panelMode}
          onClose={() => setSelected(null)}
          onSuccess={handleSuccess}
        />
      )}
      {selected && panelMode === 'assign' && (
        <AssignOwnerPanel
          cert={selected}
          users={users}
          localBus={localBus}
          onClose={() => setSelected(null)}
          onSuccess={handleAssignSuccess}
        />
      )}
      {issueOpen && (
        <IssueCertPanel
          bus={bus}
          users={users}
          onClose={() => setIssueOpen(false)}
          onIssued={handleIssued}
        />
      )}
    </div>
  );
}
