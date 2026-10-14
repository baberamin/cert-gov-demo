import { Chip } from './Chip';

export function PendingRemediationsWidget() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <p className="text-sm font-semibold text-gray-700 mb-2">Pending Remediations</p>
      <p className="text-3xl font-bold text-gray-900 mb-3">11</p>
      <div className="flex flex-wrap gap-1.5">
        <Chip label="2 Critical" color="red" />
        <Chip label="5 High" color="amber" />
        <Chip label="4 Medium" color="blue" />
      </div>
    </div>
  );
}
