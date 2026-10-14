import { ReactNode } from 'react';

interface SidePanelProps {
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

export function SidePanel({ title, onClose, footer, children }: SidePanelProps) {
  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-white border-l border-gray-200 shadow-xl flex flex-col z-20">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {children}
      </div>
      {footer && (
        <div className="px-5 py-4 border-t border-gray-200 flex gap-3">
          {footer}
        </div>
      )}
    </div>
  );
}
