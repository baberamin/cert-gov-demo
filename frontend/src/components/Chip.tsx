interface ChipProps {
  label: string;
  color: 'green' | 'red' | 'amber' | 'blue' | 'gray' | 'indigo';
}

const colorMap: Record<ChipProps['color'], string> = {
  green:  'text-green-700 bg-green-50 ring-green-200',
  red:    'text-red-700 bg-red-50 ring-red-200',
  amber:  'text-amber-700 bg-amber-50 ring-amber-200',
  blue:   'text-blue-700 bg-blue-50 ring-blue-200',
  gray:   'text-gray-500 bg-gray-100 ring-gray-200',
  indigo: 'text-indigo-700 bg-indigo-50 ring-indigo-200',
};

export function Chip({ label, color }: ChipProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${colorMap[color]}`}>
      {label}
    </span>
  );
}
