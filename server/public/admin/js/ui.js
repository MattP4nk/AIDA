/**
 * Shared UI helpers — toast, modal, table, tag rendering.
 */

// ═══ Toast ═══
export function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ═══ Modal ═══
export function openModal(title, bodyHtml, footerHtml = '') {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-footer').innerHTML = footerHtml;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

export function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// Wire close button and overlay click
document.getElementById('modal-close')?.addEventListener('click', closeModal);
document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

// ═══ Tags ═══
const tagColors = {
  active: 'green', online: 'green', completed: 'green', applied: 'green', fired: 'green', approved: 'green',
  draft: 'blue', pending: 'blue', available: 'blue',
  expired: 'yellow', warning: 'yellow', scheduled: 'yellow',
  failed: 'red', rejected: 'red', cancelled: 'red', offline: 'red',
  archived: 'gray', manual: 'gray', condition: 'gray',
};

export function tag(text) {
  const color = tagColors[text?.toLowerCase()] || 'gray';
  return `<span class="tag tag-${color}">${escHtml(text || '-')}</span>`;
}

// ═══ Escape HTML ═══
export function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ═══ Table builder ═══
export function buildTable(columns, rows, actions) {
  if (!rows.length) {
    return '<div class="empty-state"><p>No data found</p></div>';
  }
  let html = '<div class="table-wrapper"><table class="data-table"><thead><tr>';
  for (const col of columns) {
    html += `<th>${escHtml(col.label)}</th>`;
  }
  if (actions) html += '<th>Actions</th>';
  html += '</tr></thead><tbody>';

  for (const row of rows) {
    html += '<tr>';
    for (const col of columns) {
      const val = col.render ? col.render(row) : escHtml(row[col.key]);
      html += `<td>${val}</td>`;
    }
    if (actions) {
      html += `<td class="btn-group">${actions(row)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  return html;
}

// ═══ Pagination ═══
export function buildPagination(page, limit, total) {
  const totalPages = Math.ceil(total / limit);
  return `<div class="pagination">
    <span>Showing ${Math.min((page - 1) * limit + 1, total)}-${Math.min(page * limit, total)} of ${total}</span>
    <div class="btn-group">
      <button class="btn btn-small" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Prev</button>
      <span style="padding: 4px 8px; color: var(--text-muted);">${page} / ${totalPages || 1}</span>
      <button class="btn btn-small" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Next</button>
    </div>
  </div>`;
}

// ═══ Form builder ═══
export function formField(label, name, type = 'text', value = '', opts = {}) {
  const id = `field-${name}`;
  let input;
  if (type === 'textarea') {
    input = `<textarea id="${id}" name="${name}" ${opts.required ? 'required' : ''}>${escHtml(value)}</textarea>`;
  } else if (type === 'select' && opts.options) {
    const optionsHtml = opts.options.map(o => {
      const selected = o.value == value ? 'selected' : '';
      return `<option value="${escHtml(o.value)}" ${selected}>${escHtml(o.label)}</option>`;
    }).join('');
    input = `<select id="${id}" name="${name}">${opts.placeholder ? `<option value="">${opts.placeholder}</option>` : ''}${optionsHtml}</select>`;
  } else if (type === 'checkbox') {
    input = `<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="${id}" name="${name}" ${value ? 'checked' : ''}> ${escHtml(opts.checkLabel || '')}</label>`;
  } else {
    input = `<input type="${type}" id="${id}" name="${name}" value="${escHtml(value)}" ${opts.required ? 'required' : ''} ${opts.placeholder ? `placeholder="${escHtml(opts.placeholder)}"` : ''}>`;
  }
  return `<div class="form-group"><label class="form-label" for="${id}">${escHtml(label)}</label>${input}</div>`;
}

// ═══ Read form data ═══
export function readForm(container) {
  const data = {};
  container.querySelectorAll('input, select, textarea').forEach(el => {
    if (!el.name) return;
    if (el.type === 'checkbox') { data[el.name] = el.checked; }
    else if (el.type === 'number') { data[el.name] = el.value ? Number(el.value) : undefined; }
    else { data[el.name] = el.value || undefined; }
  });
  return data;
}

// ═══ Relative time ═══
export function timeAgo(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ═══ Truncate ═══
export function truncate(str, len = 50) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
}
