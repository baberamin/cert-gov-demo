import { useEffect, useState } from 'react';
import { Chip } from './Chip';
import { fetchRecommendation } from '../api';
import type { Recommendation, User } from '../api';

const COLOR = { High: 'green', Medium: 'amber', Low: 'gray', None: 'gray' } as const;

export function OwnerRecommendation({ serial, users, busy, onAccept }: {
  serial: string;
  users: User[];
  busy: boolean;
  onAccept: (user: User) => void;
}) {
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setRec(null);
    setFailed(false);
    fetchRecommendation(serial).then(r => live && setRec(r)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [serial]);

  if (failed) return null;
  const user = users.find(u => u.name === rec?.owner?.name);

  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Recommended Owner</p>
      <div className="border border-gray-200 rounded-lg px-3 py-2.5 bg-white">
        {!rec ? (
          <p className="text-xs text-gray-400">Checking evidence…</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <p className="text-sm font-medium text-gray-900">
                {rec.owner ? rec.owner.name : rec.team ? `Team: ${rec.team}` : 'No recommendation'}
              </p>
              <Chip label={rec.confidence === 'None' ? 'No evidence' : `${rec.confidence} confidence`} color={COLOR[rec.confidence]} />
            </div>
            {rec.owner && <p className="text-xs text-gray-400 mb-2">{rec.owner.email} · {rec.owner.department}</p>}
            {!rec.owner && rec.team && (
              <p className="text-xs text-gray-500 mb-2">No single owner is evidenced. Choose someone from this team below.</p>
            )}
            <details className="text-xs text-gray-500 mb-2">
              <summary className="cursor-pointer hover:text-gray-700">Evidence</summary>
              <ul className="mt-1 list-disc pl-4 space-y-0.5">
                {rec.evidence.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </details>
            {user && (
              <button
                onClick={() => onAccept(user)}
                disabled={busy}
                className="w-full px-3 py-1.5 text-sm border border-indigo-300 text-indigo-700 rounded-lg hover:bg-indigo-50 disabled:opacity-40 transition-colors"
              >
                {busy ? 'Saving…' : 'Accept Recommendation'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
