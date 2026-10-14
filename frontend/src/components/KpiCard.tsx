type Direction = 'positive' | 'negative' | 'negative-down' | 'neutral';

interface KpiCardProps {
  title: string;
  value: string;
  trend: string;
  direction: Direction;
  timeframe: string;
}

function TrendArrow({ direction }: { direction: Direction }) {
  if (direction === 'positive') return <span className="text-green-600">↑</span>;
  if (direction === 'negative') return <span className="text-red-600">↑</span>;
  if (direction === 'negative-down') return <span className="text-red-600">↓</span>;
  return null;
}

function trendColor(direction: Direction) {
  if (direction === 'positive') return 'text-green-700 bg-green-50 ring-green-200';
  if (direction === 'negative' || direction === 'negative-down') return 'text-red-700 bg-red-50 ring-red-200';
  return 'text-gray-500 bg-gray-100 ring-gray-200';
}

export function KpiCard({ title, value, trend, direction, timeframe }: KpiCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <p className="text-sm font-medium text-gray-500 mb-2">{title}</p>
      <p className="text-3xl font-bold text-gray-900 mb-3">{value}</p>
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${trendColor(direction)}`}>
          <TrendArrow direction={direction} />
          {trend}
        </span>
        <span className="text-xs text-gray-400">{timeframe}</span>
      </div>
    </div>
  );
}
