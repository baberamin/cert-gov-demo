async function renderOwnershipView() {
  const container = document.getElementById('view-container');
  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Certificate Ownership</h1>
        <p class="view-subtitle">Business unit &amp; owner mapping from DigiCert</p>
      </div>
      <select id="bu-filter" class="filter-select">
        <option value="">All Business Units</option>
      </select>
    </div>
    <div id="cert-table-wrap"><div class="loading">Loading certificates...</div></div>
    <div id="cert-detail" class="detail-panel hidden"></div>
  `;

  let certsResp, businessUnits;
  try {
    [certsResp, businessUnits] = await Promise.all([api.getCertificates(), api.getBusinessUnits()]);
  } catch {
    return;
  }
  const certs = certsResp.items || [];

  const buFilter = document.getElementById('bu-filter');
  businessUnits.forEach(bu => {
    const opt = document.createElement('option');
    opt.value = bu.id;
    opt.textContent = bu.name;
    buFilter.appendChild(opt);
  });

  buFilter.addEventListener('change', () => renderOwnershipTable(certs, buFilter.value));
  renderOwnershipTable(certs, '');
}

function renderOwnershipTable(certs, buId) {
  const wrap = document.getElementById('cert-table-wrap');
  const filtered = buId ? certs.filter(c => c.business_unit?.id === buId) : certs;

  if (!filtered.length) {
    wrap.innerHTML = '<div class="empty">No certificates found.</div>';
    return;
  }

  wrap.innerHTML = `
    <table class="cert-table">
      <thead><tr>
        <th>Common Name</th>
        <th>Business Unit</th>
        <th>Owner</th>
        <th>Tags</th>
        <th>Status</th>
        <th>Expiry</th>
      </tr></thead>
      <tbody>
        ${filtered.map(c => `
          <tr class="cert-row ${isOrphaned(c) ? 'orphaned' : ''}" data-serial="${c.serial_number}">
            <td class="cert-name">${c.common_name}</td>
            <td>${c.business_unit?.name || '<span class="unassigned">Unassigned</span>'}</td>
            <td>${c.seat?.user_name || c.seat?.seat_id || '<span class="unassigned">—</span>'}</td>
            <td>${renderTags(c.tags || [])}</td>
            <td><span class="status status-${c.status}">${formatStatus(c.status)}</span></td>
            <td class="${daysUntil(c.valid_to) < 7 ? 'expiry-warn' : ''}">${formatExpiry(c.valid_to)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll('.cert-row').forEach(row => {
    row.addEventListener('click', () => showOwnershipDetail(row.dataset.serial, filtered));
  });
}

function isOrphaned(cert) {
  return !cert.business_unit || !cert.seat;
}

function renderTags(tags) {
  if (!tags.length) return '<span class="unassigned">—</span>';
  return tags.map(t => `<span class="tag">${t.name || t}</span>`).join('');
}

function formatStatus(s) {
  const map = { issued: 'Active', revoked: 'Revoked', pending: 'Pending', expired: 'Expired' };
  return map[s] || s;
}

function daysUntil(dateStr) {
  if (!dateStr) return Infinity;
  return Math.floor((new Date(dateStr) - Date.now()) / 86400000);
}

function formatExpiry(dateStr) {
  if (!dateStr) return '—';
  const d = daysUntil(dateStr);
  if (d < 0) return 'Expired';
  if (d === 0) return 'Today';
  return `${d}d`;
}

function showOwnershipDetail(serial, certs) {
  const cert = certs.find(c => c.serial_number === serial);
  if (!cert) return;

  const detail = document.getElementById('cert-detail');
  detail.classList.remove('hidden');
  detail.innerHTML = `
    <div class="detail-label">SELECTED: ${cert.common_name}</div>
    <div class="detail-grid">
      <div><div class="detail-key">Serial</div><div class="detail-val" style="font-size:11px;font-family:monospace">${cert.serial_number}</div></div>
      <div><div class="detail-key">Issuer</div><div class="detail-val">${cert.issuer?.common_name || '—'}</div></div>
      <div><div class="detail-key">Key Size</div><div class="detail-val">${cert.key_size || '2048'}-bit RSA (software)</div></div>
      <div><div class="detail-key">Key Escrow</div><div class="detail-val">${cert.key_escrow_enabled ? 'Enabled' : 'Disabled'}</div></div>
      <div><div class="detail-key">Business Unit</div><div class="detail-val">${cert.business_unit?.name || '—'}</div></div>
      <div><div class="detail-key">Owner</div><div class="detail-val">${cert.seat?.user_name || cert.seat?.seat_id || '—'}</div></div>
      <div><div class="detail-key">Profile</div><div class="detail-val">${cert.profile?.name || '—'}</div></div>
      <div><div class="detail-key">Valid Until</div><div class="detail-val">${cert.valid_to ? new Date(cert.valid_to).toLocaleDateString() : '—'}</div></div>
    </div>
  `;
}
