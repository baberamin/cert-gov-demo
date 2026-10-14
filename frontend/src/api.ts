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
