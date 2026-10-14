import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';

interface IssuedResult {
  serial_number?: string;
  common_name?: string;
  status?: string;
  valid_from?: string;
  valid_to?: string;
  private_key?: string;
  error?: string;
}

export function IssueCertPage() {
  const [commonName, setCommonName] = useState('');
  const [dnsNamesRaw, setDnsNamesRaw] = useState('');
  const [seatId, setSeatId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IssuedResult | null>(null);
  const [showKey, setShowKey] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!commonName.trim()) return;
    setLoading(true);
    setResult(null);
    setShowKey(false);

    const dns_names = dnsNamesRaw
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(Boolean);
    if (!dns_names.length) dns_names.push(commonName.trim());

    try {
      const res = await fetch('/api/certificates/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          common_name: commonName.trim(),
          dns_names,
          seat_id: seatId.trim() || commonName.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) setResult({ error: data.error ?? JSON.stringify(data) });
      else setResult(data);
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : 'Request failed' });
    } finally {
      setLoading(false);
    }
  }

  function formatDate(s?: string) {
    if (!s) return '—';
    return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Issue Certificate"
        subtitle="Generate a new certificate from the Saviynt Test ICA via DigiCert Trust Lifecycle Manager."
      />

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
        <div className="text-xs text-gray-500 mb-5 space-y-1">
          <p><span className="font-medium text-gray-700">Profile:</span> baber private cert</p>
          <p><span className="font-medium text-gray-700">Issuing CA:</span> Saviynt Test ICA → Saviynt Test Root CA</p>
          <p><span className="font-medium text-gray-700">Key:</span> RSA 2048 · SHA-256 · 5-day validity</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Common Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={commonName}
              onChange={e => setCommonName(e.target.value)}
              placeholder="e.g. myservice.acme.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              SAN DNS Names
              <span className="text-gray-400 font-normal ml-1">(comma or newline separated — defaults to CN)</span>
            </label>
            <textarea
              value={dnsNamesRaw}
              onChange={e => setDnsNamesRaw(e.target.value)}
              rows={2}
              placeholder="myservice.acme.com, www.myservice.acme.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Seat ID
              <span className="text-gray-400 font-normal ml-1">(defaults to CN)</span>
            </label>
            <input
              type="text"
              value={seatId}
              onChange={e => setSeatId(e.target.value)}
              placeholder="e.g. myservice.acme.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !commonName.trim()}
            className="w-full px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
          >
            {loading ? 'Generating keypair & enrolling…' : 'Issue Certificate'}
          </button>
        </form>
      </div>

      {result && (
        result.error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5">
            <p className="text-sm font-medium text-red-700 mb-1">Enrollment failed</p>
            <p className="text-sm text-red-600 font-mono break-all">{result.error}</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-green-200 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset text-green-700 bg-green-50 ring-green-200">
                Issued
              </span>
              <p className="text-sm font-semibold text-gray-900">{result.common_name}</p>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-5 text-sm">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Serial Number</p>
                <p className="font-mono text-gray-700 text-xs break-all">{result.serial_number ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Status</p>
                <p className="text-gray-700 capitalize">{result.status ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Valid From</p>
                <p className="text-gray-700">{formatDate(result.valid_from)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Valid To</p>
                <p className="text-gray-700">{formatDate(result.valid_to)}</p>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Private Key</p>
                <button
                  onClick={() => setShowKey(v => !v)}
                  className="text-xs text-indigo-600 hover:text-indigo-800"
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
              {showKey ? (
                <pre className="text-xs font-mono bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all text-gray-700">
                  {result.private_key}
                </pre>
              ) : (
                <p className="text-xs text-gray-400">
                  Private key generated server-side. Store it securely — it is not persisted by this application.
                </p>
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}
