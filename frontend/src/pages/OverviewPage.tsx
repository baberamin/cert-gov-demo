import { useState, useEffect } from 'react';
import { PageHeader } from '../components/PageHeader';
import { KpiCard } from '../components/KpiCard';
import { Chip } from '../components/Chip';
import { fetchOverview } from '../api';
import type { OverviewStats } from '../api';

export function OverviewPage() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchOverview()
      .then(setStats)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-16 text-gray-400">Loading...</div>;
  if (error) return <div className="text-center py-16 text-red-500">{error}</div>;
  if (!stats) return null;

  const openFindings = stats.findings_critical + stats.findings_high + stats.findings_medium + stats.findings_low;

  const kpis = [
    {
      title: 'Active Certificates',
      value: String(stats.total_active),
      trend: '',
      direction: 'neutral' as const,
      timeframe: 'total active',
    },
    {
      title: 'Ownership Coverage',
      value: `${stats.owned_pct}%`,
      trend: '',
      direction: stats.owned_pct >= 80 ? 'positive' as const : 'negative' as const,
      timeframe: 'of active certs',
    },
    {
      title: 'Expiring ≤ 30 days',
      value: String(stats.expiring_30),
      trend: '',
      direction: stats.expiring_30 > 0 ? 'negative' as const : 'neutral' as const,
      timeframe: 'need rotation',
    },
    {
      title: 'Open Findings',
      value: String(openFindings),
      trend: '',
      direction: (stats.findings_critical + stats.findings_high) > 0 ? 'negative' as const : 'neutral' as const,
      timeframe: 'across all severities',
    },
  ];

  return (
    <div>
      <PageHeader title="Certificates" subtitle="DigiCert Trust Lifecycle Manager — ACME Corp" />

      <div className="grid grid-cols-4 gap-4 mb-6">
        {kpis.map(kpi => (
          <KpiCard key={kpi.title} {...kpi} />
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Findings Breakdown</h3>
        <div className="grid grid-cols-4 gap-4 mb-4">
          {([
            { label: 'Critical', value: stats.findings_critical, color: 'red' as const },
            { label: 'High',     value: stats.findings_high,     color: 'amber' as const },
            { label: 'Medium',   value: stats.findings_medium,   color: 'blue' as const },
            { label: 'Low',      value: stats.findings_low,      color: 'gray' as const },
          ]).map(({ label, value, color }) => (
            <div key={label} className="text-center">
              <p className="text-3xl font-bold text-gray-900 mb-2">{value}</p>
              <Chip label={label} color={color} />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 text-sm text-gray-600">
          <div>Expiring in 31–60 days: <span className="font-semibold">{stats.expiring_60}</span></div>
          <div>Expiring in 61–90 days: <span className="font-semibold">{stats.expiring_90}</span></div>
        </div>
      </div>
    </div>
  );
}
