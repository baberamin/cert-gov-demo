import { KEY_COMPLIANCE_BUS } from '../mockData';

export function KeyComplianceWidget() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 col-span-2">
      <p className="text-sm font-semibold text-gray-700 mb-4">Key Compliance</p>
      <div className="flex flex-col gap-3">
        {KEY_COMPLIANCE_BUS.map(bu => {
          const total = bu.hsm + bu.sw;
          const hsmPct = total ? Math.round((bu.hsm / total) * 100) : 0;
          const swPct = 100 - hsmPct;
          return (
            <div key={bu.name} className="flex items-center gap-3">
              <span className="w-24 text-sm text-gray-600 shrink-0">{bu.name}</span>
              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full" style={{ width: `${hsmPct}%` }} />
              </div>
              <div className="flex gap-2 text-xs text-gray-500 shrink-0 w-32">
                <span className="text-green-700 font-medium">{bu.hsm} HSM</span>
                <span className="text-amber-700 font-medium">{bu.sw} SW</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-400 mt-4">312 of 461 certificates use hardware-bound keys</p>
    </div>
  );
}
