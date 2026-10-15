export interface Cert {
  serial_number: string;
  common_name: string | null;
  status: string;
  valid_to: string;
  valid_from: string;
  profile?: { id: string; name: string };
  business_unit?: { id: string; name: string };
  san?: { dns_names?: string[]; ip_addresses?: string[] };
  seat?: { seat_id?: string; seat_name?: string; email?: string };
  subject?: { common_name?: string; organization_name?: string; organization_units?: string[] };
  key_size?: string | number;
  signature_algorithm?: string;
  extended_key_usage?: string;
  ca_vendor?: string;
  issuing_ca_name?: string;
  thumbprint?: string;
  escrow?: boolean;
  quantum_safe?: boolean;
  expires_in_days?: number;
  attributes?: string;
  ica?: { id: string; name?: string };
  issuer?: { common_name?: string; organization?: string };
}

export interface BusinessUnit { id: string; name: string; }

export interface User {
  id: string;
  name: string;
  email: string;
  department: string;
}

export async function fetchUsers(): Promise<User[]> {
  const res = await fetch('/api/users');
  if (!res.ok) return [];
  return res.json();
}

export async function fetchCertificates(params?: Record<string, string>): Promise<Cert[]> {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const res = await fetch(`/api/certificates${qs}`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return Array.isArray(data) ? data : (data.certificates ?? data.items ?? []);
}

export async function fetchCertificate(serial: string): Promise<Cert> {
  const res = await fetch(`/api/certificates/${serial}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchBusinessUnits(): Promise<BusinessUnit[]> {
  const res = await fetch('/api/business-units');
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return Array.isArray(data) ? data : (data.business_units ?? data.items ?? []);
}

export async function revoke(serial: string, reason: string): Promise<void> {
  const res = await fetch(`/api/certificates/${serial}/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function reissue(serial: string, reason: string): Promise<void> {
  const res = await fetch(`/api/certificates/${serial}/reissue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function cancel(serial: string): Promise<void> {
  const res = await fetch(`/api/certificates/${serial}/cancel`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
}

export async function fetchOwnerAssignments(): Promise<Record<string, string>> {
  const res = await fetch('/api/owner-assignments');
  if (!res.ok) return {};
  return res.json();
}

export async function fetchBuAssignments(): Promise<Record<string, { id: string; name: string }>> {
  const res = await fetch('/api/bu-assignments');
  if (!res.ok) return {};
  return res.json();
}

export async function assignOwner(
  serial: string,
  ownerName: string,
  ownerEmail?: string,
  seatId?: string,
): Promise<void> {
  const res = await fetch(`/api/certificates/${serial}/assign-owner`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner_name: ownerName, owner_email: ownerEmail, seat_id: seatId }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function syncBusinessUnits(): Promise<{ results: { name: string; status: string; id?: string }[] }> {
  const res = await fetch('/api/business-units/sync', { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface Finding {
  id: string;
  serial_number: string;
  common_name: string | null;
  finding_type: 'expiring_soon' | 'unowned' | 'weak_key' | 'long_lived' | 'quantum_unsafe';
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'in-review' | 'resolved';
  detail: string;
  created_at: string;
  updated_at: string;
}

export interface OverviewStats {
  total_active: number;
  owned_pct: number;
  expiring_30: number;
  expiring_60: number;
  expiring_90: number;
  findings_critical: number;
  findings_high: number;
  findings_medium: number;
  findings_low: number;
}

export async function fetchFindings(): Promise<Finding[]> {
  const res = await fetch('/api/findings');
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchOverview(): Promise<OverviewStats> {
  const res = await fetch('/api/overview');
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateFindingStatus(
  id: string,
  status: 'open' | 'in-review' | 'resolved',
): Promise<Finding> {
  const res = await fetch(`/api/findings/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface CampaignItem {
  id: string;
  campaign_id: string;
  serial_number: string;
  common_name: string | null;
  seat_id: string | null;
  owner: string;
  bu_name: string;
  valid_to: string;
  decision: 'approved' | 'revoked' | 'reassigned' | null;
  new_owner: string | null;
  new_owner_email: string | null;
  decided_at: string | null;
}

export interface Campaign {
  id: string;
  name: string;
  scope_bu_id: string | null;
  deadline: string | null;
  status: 'active' | 'completed' | 'cancelled';
  created_at: string;
  total: number;
  approved: number;
  revoked: number;
  reassigned: number;
  pending: number;
}

export interface CampaignDetail extends Campaign {
  items: CampaignItem[];
}

export async function fetchCampaigns(): Promise<Campaign[]> {
  const res = await fetch('/api/campaigns');
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchCampaign(id: string): Promise<CampaignDetail> {
  const res = await fetch(`/api/campaigns/${id}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createCampaign(
  name: string,
  scope_bu_id?: string,
  deadline?: string,
): Promise<{ id: string; name: string; item_count: number }> {
  const res = await fetch('/api/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, scope_bu_id: scope_bu_id || null, deadline: deadline || null }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function decideCampaignItem(
  campaignId: string,
  serial: string,
  decision: 'approved' | 'revoked' | 'reassigned',
  new_owner?: string,
  new_owner_email?: string,
): Promise<CampaignItem> {
  const res = await fetch(`/api/campaigns/${campaignId}/items/${serial}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, new_owner, new_owner_email }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
