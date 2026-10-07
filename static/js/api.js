function showError(message) {
  const banner = document.getElementById('error-banner');
  banner.textContent = message;
  banner.classList.remove('hidden');
  setTimeout(() => banner.classList.add('hidden'), 8000);
}

async function apiFetch(path, options = {}) {
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };
  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }

  const resp = await fetch(path, config);

  if (!resp.ok) {
    let msg;
    try {
      const err = await resp.json();
      msg = err.message || err.error || JSON.stringify(err);
    } catch {
      msg = `HTTP ${resp.status}: ${resp.statusText}`;
    }
    showError(`DigiCert API error: ${msg}`);
    throw new Error(msg);
  }

  if (resp.status === 204) return null;
  return resp.json();
}

const api = {
  getCertificates:   ()             => apiFetch('/api/certificates'),
  getCertificate:    (serial)       => apiFetch(`/api/certificates/${serial}`),
  enrollCertificate: (body)         => apiFetch('/api/certificates', { method: 'POST', body }),
  getProfiles:       ()             => apiFetch('/api/profiles'),
  getBusinessUnits:  ()             => apiFetch('/api/business-units'),
  getSeats:          ()             => apiFetch('/api/seats'),
  revoke:  (serial, reason) => apiFetch(`/api/certificates/${serial}/revoke`,  { method: 'POST', body: { reason } }),
  reissue: (serial)         => apiFetch(`/api/certificates/${serial}/reissue`, { method: 'POST' }),
  cancel:  (serial)         => apiFetch(`/api/certificates/${serial}/cancel`,  { method: 'POST' }),
};
