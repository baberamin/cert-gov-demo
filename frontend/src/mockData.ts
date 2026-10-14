export const OVERVIEW_KPIS = [
  {
    title: 'Certificate Health',
    value: '94.2%',
    trend: '+1.4%',
    direction: 'positive' as const,
    timeframe: 'vs last 30 days',
  },
  {
    title: 'Expiring Soon',
    value: '23',
    trend: '+8',
    direction: 'negative' as const,
    timeframe: 'within 90 days',
  },
  {
    title: 'Agent Health',
    value: '47 / 51',
    trend: '−4',
    direction: 'negative-down' as const,
    timeframe: 'agents online',
  },
  {
    title: 'DCV Risk',
    value: '6',
    trend: '+2',
    direction: 'negative' as const,
    timeframe: 'open issues',
  },
];

export const KEY_COMPLIANCE_BUS = [
  { name: 'Engineering', hsm: 3, sw: 5 },
  { name: 'DevOps',      hsm: 4, sw: 3 },
  { name: 'Finance',     hsm: 1, sw: 4 },
  { name: 'Marketing',   hsm: 0, sw: 2 },
  { name: 'Legal',       hsm: 2, sw: 1 },
];

export interface Finding {
  id: string;
  title: string;
  description: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'in-review' | 'resolved';
  affectedAsset: string;
  affectedCount: number;
  detectedOn: string;
  remediationSteps: string;
}

export const FINDINGS: Finding[] = [
  {
    id: 'F-001',
    title: 'Software key storage on payment-critical cert',
    description: 'api.payments.acme.com uses Software key storage. PCI-DSS requires HSM for payment infrastructure.',
    category: 'Key Compliance',
    severity: 'critical',
    status: 'open',
    affectedAsset: 'api.payments.acme.com',
    affectedCount: 1,
    detectedOn: '2026-10-01',
    remediationSteps: 'Revoke and reissue cert with HSM key storage via DigiCert Trust Lifecycle Manager.',
  },
  {
    id: 'F-002',
    title: '4 certificates expire in < 30 days',
    description: 'Four certs are within the 30-day expiry warning window with no auto-renewal configured.',
    category: 'Key Compliance',
    severity: 'high',
    status: 'open',
    affectedAsset: 'Multiple',
    affectedCount: 4,
    detectedOn: '2026-10-02',
    remediationSteps: 'Initiate reissue for each expiring cert or enable auto-renewal in DigiCert.',
  },
  {
    id: 'F-003',
    title: 'Revoked cert still referenced in load balancer config',
    description: 'lb-internal.acme.com was revoked but the F5 config still references it, causing handshake failures.',
    category: 'DCV / CA Ops',
    severity: 'critical',
    status: 'in-review',
    affectedAsset: 'lb-internal.acme.com',
    affectedCount: 1,
    detectedOn: '2026-09-29',
    remediationSteps: 'Update F5 virtual server to bind the replacement cert.',
  },
  {
    id: 'F-004',
    title: '4 agents offline > 48 h',
    description: 'Agents on prod-node-07 through prod-node-10 last reported 54 hours ago. Discovery is stale.',
    category: 'Agent Health',
    severity: 'high',
    status: 'open',
    affectedAsset: 'prod-node-07 … prod-node-10',
    affectedCount: 4,
    detectedOn: '2026-10-04',
    remediationSteps: 'Restart the DigiCert agent service on affected nodes. Verify egress to demo.one.digicert.com:443.',
  },
  {
    id: 'F-005',
    title: 'SHA-1 signature hash detected',
    description: 'legacy-vpn.acme.com uses SHA-1, deprecated and rejected by modern trust stores.',
    category: 'Key Compliance',
    severity: 'high',
    status: 'open',
    affectedAsset: 'legacy-vpn.acme.com',
    affectedCount: 1,
    detectedOn: '2026-09-15',
    remediationSteps: 'Reissue with SHA-256 or higher. Validate VPN client compatibility before cutover.',
  },
  {
    id: 'F-006',
    title: 'Wildcard cert shared across 3 BUs',
    description: '*.acme.com is deployed in Engineering, DevOps, and Marketing. A compromise affects all three simultaneously.',
    category: 'Key Compliance',
    severity: 'medium',
    status: 'open',
    affectedAsset: '*.acme.com',
    affectedCount: 3,
    detectedOn: '2026-10-03',
    remediationSteps: 'Replace wildcard with per-service SAN certs scoped to each BU.',
  },
  {
    id: 'F-007',
    title: 'DCV domain validation lapsed on staging cert',
    description: 'staging.acme.com DCV token expired before the cert was issued. The pending order must be cancelled and restarted.',
    category: 'DCV / CA Ops',
    severity: 'medium',
    status: 'resolved',
    affectedAsset: 'staging.acme.com',
    affectedCount: 1,
    detectedOn: '2026-09-20',
    remediationSteps: 'Cancel the stale pending order. Re-initiate issuance and complete DCV within 30 days.',
  },
  {
    id: 'F-008',
    title: 'Spike in certificate issuance — Finance BU',
    description: 'Finance BU issued 11 certificates in 24 hours, 4× the monthly average. Possible automated mis-issuance.',
    category: 'Issuance Anomaly',
    severity: 'medium',
    status: 'in-review',
    affectedAsset: 'Finance BU',
    affectedCount: 11,
    detectedOn: '2026-10-05',
    remediationSteps: 'Review Finance BU issuance logs. Revoke any certs not associated with a known deployment.',
  },
];
