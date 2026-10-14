import { PageHeader } from '../components/PageHeader';
import { KpiCard } from '../components/KpiCard';
import { KeyComplianceWidget } from '../components/KeyComplianceWidget';
import { IssuanceVelocityWidget } from '../components/IssuanceVelocityWidget';
import { PendingRemediationsWidget } from '../components/PendingRemediationsWidget';
import { OVERVIEW_KPIS } from '../mockData';

export function OverviewPage() {
  return (
    <div>
      <PageHeader title="Certificates" subtitle="DigiCert Trust Lifecycle Manager — ACME Corp" />

      <div className="grid grid-cols-4 gap-4 mb-6">
        {OVERVIEW_KPIS.map(kpi => (
          <KpiCard key={kpi.title} {...kpi} />
        ))}
      </div>

      <div className="grid grid-cols-4 gap-4">
        <KeyComplianceWidget />
        <IssuanceVelocityWidget />
        <PendingRemediationsWidget />
      </div>
    </div>
  );
}
