export function IssuanceVelocityWidget() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <p className="text-sm font-semibold text-gray-700 mb-2">Issuance Velocity</p>
      <p className="text-3xl font-bold text-gray-900 mb-2">142</p>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset text-gray-500 bg-gray-100 ring-gray-200">
          +18%
        </span>
        <span className="text-xs text-gray-400">vs prior week</span>
      </div>
      <p className="text-xs text-gray-400 mt-2">certs issued this month</p>
    </div>
  );
}
