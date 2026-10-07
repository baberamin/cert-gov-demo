const REVOCATION_REASONS = [
  { value: 'key_compromise',        label: 'Key Compromise' },
  { value: 'cessation_of_operation', label: 'Cessation of Operation' },
  { value: 'superseded',            label: 'Superseded' },
  { value: 'unspecified',           label: 'Unspecified' },
];

async function renderRemediationView() {
  const container = document.getElementById('view-container');
  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Certificate Remediation</h1>
        <p class="view-subtitle">Revoke, replace, or cancel certificates via DigiCert API</p>
      </div>
    </div>
    <div id="remediation-wrap"><div class="loading">Loading certificates...</div></div>
  `;

  let certs;
  try {
    certs = await api.getCertificates();
  } catch {
    return;
  }

  renderRemediationTable(certs);
}

function renderRemediationTable(certs) {
  document.getElementById('remediation-wrap').innerHTML = `
    <table class="cert-table">
      <thead><tr>
        <th>Common Name</th><th>Profile</th><th>Status</th><th>Expiry</th><th>Actions</th>
      </tr></thead>
      <tbody id="rem-tbody">
        ${certs.map(c => remRow(c)).join('')}
      </tbody>
    </table>
  `;
  attachRemHandlers(certs);
}

function remRow(cert) {
  const s = cert.status;
  const isRevoked = s === 'revoked' || s === 'expired';
  const isPending = s === 'pending';
  const isActive  = s === 'issued';
  const d = daysUntilRem(cert.valid_till);
  const expiryClass = d !== null && d < 7 ? 'expiry-warn' : '';

  const actions = isRevoked
    ? '<span class="no-action">—</span>'
    : isPending
      ? `<button class="btn btn-cancel" data-action="cancel" data-serial="${cert.serial_number}">Cancel</button>`
      : isActive
        ? `<button class="btn btn-revoke" data-action="revoke" data-serial="${cert.serial_number}">Revoke</button>
           <button class="btn btn-replace" data-action="reissue" data-serial="${cert.serial_number}">Replace</button>`
        : '';

  return `
    <tr id="row-${cert.serial_number}" class="cert-row ${isRevoked ? 'row-revoked' : ''}">
      <td class="cert-name">${cert.common_name}</td>
      <td>${cert.profile?.name || '—'}</td>
      <td><span class="status status-${s}">${formatStatusRem(s)}</span></td>
      <td class="${expiryClass}">${formatExpiryRem(cert.valid_till)}</td>
      <td class="actions-cell">${actions}</td>
    </tr>
  `;
}

function formatStatusRem(s) {
  return { issued: 'Active', revoked: 'Revoked', pending: 'Pending', expired: 'Expired' }[s] || s;
}

function daysUntilRem(dateStr) {
  if (!dateStr) return null;
  return Math.floor((new Date(dateStr) - Date.now()) / 86400000);
}

function formatExpiryRem(dateStr) {
  if (!dateStr) return '—';
  const d = daysUntilRem(dateStr);
  if (d < 0) return 'Expired';
  if (d === 0) return 'Today';
  return `${d}d`;
}

function attachRemHandlers(certs) {
  document.getElementById('rem-tbody').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, serial } = btn.dataset;
    const cert = certs.find(c => c.serial_number === serial);
    if (!cert) return;
    if (action === 'revoke')  showRevokeModal(cert, certs);
    if (action === 'reissue') doReissue(cert, certs);
    if (action === 'cancel')  doCancel(cert, certs);
  });
}

function showRevokeModal(cert, certs) {
  const overlay = document.getElementById('modal-overlay');
  const modal   = document.getElementById('modal');
  overlay.classList.remove('hidden');

  modal.innerHTML = `
    <div class="modal-title">Revoke: ${cert.common_name}</div>
    <div class="modal-label">Select revocation reason:</div>
    <div class="reason-buttons">
      ${REVOCATION_REASONS.map(r =>
        `<button class="reason-btn" data-reason="${r.value}">${r.label}</button>`
      ).join('')}
    </div>
    <div class="modal-actions">
      <button id="confirm-revoke" class="btn btn-revoke" disabled>Confirm Revoke</button>
      <button id="cancel-modal" class="btn btn-secondary">Cancel</button>
    </div>
  `;

  let selectedReason = null;
  modal.querySelectorAll('.reason-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.reason-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedReason = btn.dataset.reason;
      document.getElementById('confirm-revoke').disabled = false;
    });
  });

  document.getElementById('cancel-modal').addEventListener('click', closeModal);
  document.getElementById('confirm-revoke').addEventListener('click', async () => {
    closeModal();
    setRowWorking(cert.serial_number);
    try {
      await api.revoke(cert.serial_number, selectedReason);
      updateCert(certs, cert.serial_number, { status: 'revoked' });
      refreshRow(cert.serial_number, certs);
    } catch {
      setRowWorking(cert.serial_number, 'Error — see banner');
    }
  });
}

async function doReissue(cert, certs) {
  if (!confirm(`Issue a replacement for ${cert.common_name} and revoke the original?`)) return;
  setRowWorking(cert.serial_number);
  try {
    const newCert = await api.reissue(cert.serial_number);
    const idx = certs.findIndex(c => c.serial_number === cert.serial_number);
    if (idx !== -1) certs.splice(idx, 1);
    certs.unshift(newCert);
    renderRemediationTable(certs);
  } catch {
    setRowWorking(cert.serial_number, 'Error — see banner');
  }
}

async function doCancel(cert, certs) {
  if (!confirm(`Cancel pending issuance for ${cert.common_name}?`)) return;
  setRowWorking(cert.serial_number);
  try {
    await api.cancel(cert.serial_number);
    updateCert(certs, cert.serial_number, { status: 'revoked' });
    refreshRow(cert.serial_number, certs);
  } catch {
    setRowWorking(cert.serial_number, 'Error — see banner');
  }
}

function setRowWorking(serial, msg = 'Working...') {
  const row = document.getElementById(`row-${serial}`);
  if (row) row.querySelector('.actions-cell').innerHTML = `<span class="working">${msg}</span>`;
}

function updateCert(certs, serial, updates) {
  const cert = certs.find(c => c.serial_number === serial);
  if (cert) Object.assign(cert, updates);
}

function refreshRow(serial, certs) {
  const cert = certs.find(c => c.serial_number === serial);
  const row  = document.getElementById(`row-${serial}`);
  if (cert && row) row.outerHTML = remRow(cert);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}
