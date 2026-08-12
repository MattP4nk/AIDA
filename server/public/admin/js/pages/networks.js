import * as api from '../api.js';
import { toast, openModal, closeModal, tag, escHtml, buildTable, formField, readForm } from '../ui.js';

async function renderList(container) {
  try {
    const res = await api.getNetworks();
    const networks = res.data || [];

    const tableHtml = buildTable(
      [
        { label: 'Name', key: 'name' },
        { label: 'Zone', key: 'zone', render: r => escHtml(r.zone || '-') },
        { label: 'Description', key: 'description', render: r => escHtml(r.description ? r.description.substring(0, 60) + (r.description.length > 60 ? '...' : '') : '-') },
        { label: 'Servers', key: 'servers', render: r => (r._count?.servers ?? 0) },
      ],
      networks,
      (row) => {
        const serverCount = row._count?.servers ?? 0;
        return `
          <button class="btn btn-small" data-action="edit" data-id="${row.id}">Edit</button>
          ${serverCount === 0 ? `<button class="btn btn-small btn-danger" data-action="delete" data-id="${row.id}">Delete</button>` : ''}
        `;
      }
    );

    container.innerHTML = `
      <div class="page-header">
        <h2 class="page-title">Networks</h2>
        <button class="btn btn-primary" id="btn-create-network">+ Create Network</button>
      </div>
      ${tableHtml}
    `;

    container.querySelector('#btn-create-network').addEventListener('click', () => showModal(container, null));

    // Row clicks → detail view (but not on action buttons)
    container.querySelectorAll('.data-table tbody tr').forEach((tr, i) => {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) return;
        renderDetail(container, networks[i].id);
      });
    });

    container.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (action === 'edit') {
        const network = networks.find(n => n.id === id);
        if (network) showModal(container, network);
      } else if (action === 'delete') {
        if (!confirm('Delete this network?')) return;
        try {
          await api.deleteNetwork(id);
          toast('Network deleted', 'success');
          renderList(container);
        } catch (err) {
          toast(err.message, 'error');
        }
      }
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Error loading networks</p></div>`;
    toast(err.message, 'error');
  }
}

async function renderDetail(container, networkId) {
  try {
    const res = await api.getNetwork(networkId);
    const network = res.data;
    const servers = network.servers || [];

    const serversTable = buildTable(
      [
        { label: 'Name', key: 'name' },
        { label: 'IP', key: 'ipAddress' },
        { label: 'Type', key: 'type' },
        { label: 'Role', key: 'role' },
        { label: 'Security', key: 'securityLevel' },
        { label: 'Access', key: 'accessMethod', render: r => escHtml(r.accessMethod || 'open') },
        { label: 'Online', key: 'isOnline', render: r => tag(r.isOnline ? 'online' : 'offline') },
      ],
      servers
    );

    container.innerHTML = `
      <div class="page-header">
        <h2 class="page-title">
          <a href="#" id="back-to-list" style="color:var(--text-muted);text-decoration:none;">&larr; Networks</a>
          / ${escHtml(network.name)}
        </h2>
        <button class="btn btn-small" id="btn-edit-network">Edit</button>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">Zone</div><div class="stat-value">${escHtml(network.zone || '-')}</div></div>
        <div class="stat-card"><div class="stat-label">Servers</div><div class="stat-value">${servers.length}</div></div>
      </div>
      ${network.description ? `<div class="section"><h3 class="section-title">Description</h3><p style="color:var(--text-secondary);font-size:12px;">${escHtml(network.description)}</p></div>` : ''}
      <div class="section">
        <h3 class="section-title">Servers (${servers.length})</h3>
        ${serversTable}
      </div>
    `;

    container.querySelector('#back-to-list').addEventListener('click', (e) => {
      e.preventDefault();
      renderList(container);
    });

    container.querySelector('#btn-edit-network').addEventListener('click', () => {
      showModal(container, network, () => renderDetail(container, networkId));
    });

    // Click server rows → navigate to server detail in the servers page
    container.querySelectorAll('.data-table tbody tr').forEach((tr, i) => {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => {
        // Navigate to servers page with the server ID as sub-route
        window.location.hash = `servers/${servers[i].id}`;
      });
    });
  } catch (err) {
    toast(err.message, 'error');
    renderList(container);
  }
}

function showModal(container, network, onSave) {
  const isEdit = !!network;
  const body = `
    <div class="form-row">${formField('Name', 'name', 'text', network?.name || '', { required: true })}</div>
    <div class="form-row">${formField('Description', 'description', 'textarea', network?.description || '')}</div>
    <div class="form-row">${formField('Zone', 'zone', 'text', network?.zone || '')}</div>
  `;

  const footer = `
    <button class="btn" id="modal-cancel">Cancel</button>
    <button class="btn btn-primary" id="modal-save">${isEdit ? 'Save' : 'Create'}</button>
  `;

  openModal(isEdit ? 'Edit Network' : 'Create Network', body, footer);

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', async () => {
    try {
      const formData = readForm(document.getElementById('modal-body'));
      if (isEdit) {
        await api.updateNetwork(network.id, formData);
        toast('Network updated', 'success');
      } else {
        await api.createNetwork(formData);
        toast('Network created', 'success');
      }
      closeModal();
      if (onSave) onSave();
      else renderList(container);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

export default async function render(container) {
  await renderList(container);
}
