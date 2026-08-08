import * as api from '../api.js';
import { toast, openModal, closeModal, tag, escHtml, buildTable, buildPagination, formField, readForm, timeAgo } from '../ui.js';

let currentPage = 1;
let filterType = '';
let searchQuery = '';

async function renderList(container) {
  try {
    const params = new URLSearchParams({ page: currentPage, limit: 25 });
    if (filterType) params.set('type', filterType);
    if (searchQuery) params.set('search', searchQuery);

    const res = await api.getServers(params.toString());
    const servers = res.data || [];
    const total = res.total || servers.length;

    const tableHtml = buildTable(
      [
        { label: 'Name', key: 'name' },
        { label: 'IP', key: 'ipAddress' },
        { label: 'Type', key: 'type' },
        { label: 'Role', key: 'role' },
        { label: 'Security', key: 'securityLevel' },
        { label: 'Files', key: 'files', render: r => (r._count?.fileSystemNodes ?? r._count?.files ?? 0) },
        { label: 'Links', key: 'links', render: r => (r._count?.serverLinks ?? r._count?.links ?? 0) },
        { label: 'Online', key: 'isOnline', render: r => tag(r.isOnline ? 'online' : 'offline') },
      ],
      servers
    );

    container.innerHTML = `
      <div class="page-header">
        <h2 class="page-title">Servers</h2>
        <button class="btn btn-primary" id="btn-create-server">+ Create Server</button>
      </div>
      <div class="toolbar">
        <select id="filter-type">
          <option value="">All Types</option>
          <option value="underground" ${filterType === 'underground' ? 'selected' : ''}>Underground / DarkNet</option>
          <option value="corporate" ${filterType === 'corporate' ? 'selected' : ''}>Corporate</option>
          <option value="government" ${filterType === 'government' ? 'selected' : ''}>Government</option>
          <option value="tutorial" ${filterType === 'tutorial' ? 'selected' : ''}>Tutorial</option>
          <option value="player_home" ${filterType === 'player_home' ? 'selected' : ''}>Player Home</option>
          <option value="public" ${filterType === 'public' ? 'selected' : ''}>Public</option>
        </select>
        <input type="text" id="search-input" placeholder="Search servers..." value="${escHtml(searchQuery)}">
      </div>
      ${tableHtml}
      ${buildPagination(currentPage, 25, total)}
    `;

    // Event listeners
    container.querySelector('#btn-create-server').addEventListener('click', () => showCreateModal(container));

    container.querySelector('#filter-type').addEventListener('change', (e) => {
      filterType = e.target.value;
      currentPage = 1;
      renderList(container);
    });

    container.querySelector('#search-input').addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        searchQuery = e.target.value;
        currentPage = 1;
        renderList(container);
      }
    });

    // Row clicks
    container.querySelectorAll('.data-table tbody tr').forEach((tr, i) => {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => renderDetail(container, servers[i].id));
    });

    // Pagination
    container.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.page);
        if (p >= 1) { currentPage = p; renderList(container); }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Error loading servers</p></div>`;
    toast(err.message, 'error');
  }
}

async function showCreateModal(container) {
  let networks = [];
  try {
    const res = await api.getNetworks();
    networks = res.data || [];
  } catch { /* proceed without networks */ }

  const networkOpts = networks.map(n => ({ value: n.id, label: n.name }));

  const body = `
    <div class="form-row">${formField('Name', 'name', 'text', '', { required: true })}</div>
    <div class="form-row">${formField('IP Address', 'ipAddress', 'text', '', { required: true })}</div>
    <div class="form-row">${formField('Type', 'type', 'select', 'underground', { options: [
      { value: 'underground', label: 'Underground / DarkNet' }, { value: 'corporate', label: 'Corporate' },
      { value: 'government', label: 'Government' }, { value: 'tutorial', label: 'Tutorial' },
      { value: 'public', label: 'Public' },
    ]})}</div>
    <div class="form-row">${formField('Role', 'role', 'select', 'general', { options: [
      { value: 'gateway', label: 'Gateway' }, { value: 'router', label: 'Router' },
      { value: 'workstation', label: 'Workstation' }, { value: 'database', label: 'Database' },
      { value: 'email', label: 'Email' }, { value: 'firewall', label: 'Firewall' },
      { value: 'dns', label: 'DNS' }, { value: 'general', label: 'General' },
    ] })}</div>
    <div class="form-row">${formField('Security Level', 'securityLevel', 'number', '1')}</div>
    <div class="form-row">${formField('Firewall Level', 'firewallLevel', 'number', '0')}</div>
    <div class="form-row">${formField('Encryption Level', 'encryptionLevel', 'number', '0')}</div>
    <div class="form-row">${formField('Discovery Level', 'discoveryLevel', 'number', '0')}</div>
    <div class="form-row">${formField('Network', 'networkId', 'select', '', { options: networkOpts, placeholder: 'Select network...' })}</div>
    <div class="form-row">${formField('Faction ID', 'factionId', 'text')}</div>
    <div class="form-row">${formField('Public', 'isPublic', 'checkbox', false, { checkLabel: 'Publicly visible' })}</div>
    <div class="form-row">${formField('Access Method', 'accessMethod', 'select', 'open', { options: [
      { value: 'open', label: 'Open' }, { value: 'hackable', label: 'Hackable' },
      { value: 'keycard', label: 'Keycard' }, { value: 'hack_or_key', label: 'Hack or Key' },
    ] })}</div>
    <div class="form-row">${formField('Max Connections', 'maxConnections', 'number', '10')}</div>
  `;

  const footer = `
    <button class="btn" id="modal-cancel">Cancel</button>
    <button class="btn btn-primary" id="modal-save">Create</button>
  `;

  openModal('Create Server', body, footer);

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', async () => {
    try {
      const formData = readForm(document.getElementById('modal-body'));
      await api.createServer(formData);
      closeModal();
      toast('Server created', 'success');
      renderList(container);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function renderDetail(container, id) {
  try {
    const res = await api.getServer(id);
    const server = res.data;
    const files = server.fileSystem || server.files || [];
    const linksOut = server.linksOut || [];
    const linksIn = server.linksIn || [];
    const links = [
      ...linksOut.map(l => ({ ...l, direction: 'out', target: l.target })),
      ...linksIn.map(l => ({ ...l, direction: 'in', target: l.source })),
    ];

    // Build a parentId → name lookup for path display
    const idToName = {};
    files.forEach(f => { idToName[f.id] = f.name; });
    function getPath(node) {
      const parts = [node.name];
      let pid = node.parentId;
      while (pid && idToName[pid]) {
        if (idToName[pid] === '/') break;
        parts.unshift(idToName[pid]);
        pid = files.find(f => f.id === pid)?.parentId;
      }
      return '/' + parts.join('/');
    }

    const filesHtml = files.length === 0
      ? '<div class="empty-state"><p>No files</p></div>'
      : '<div class="table-wrapper"><table class="data-table"><thead><tr><th>Path</th><th>Type</th><th>Size</th><th>Hidden</th></tr></thead><tbody>'
        + files.map((f, i) => {
          const path = getPath(f);
          const isFile = f.type === 'file';
          const hasContent = isFile && f.content;
          const icon = isFile ? '&#128196; ' : '&#128193; ';
          const color = isFile ? 'var(--text-primary)' : 'var(--accent-blue)';
          return `<tr${hasContent ? ` style="cursor:pointer" data-file-idx="${i}"` : ''}>
            <td><span style="color:${color}">${icon}${escHtml(path)}</span></td>
            <td>${tag(f.type)}</td>
            <td>${isFile ? (f.size || 0) + 'B' : '-'}</td>
            <td>${f.isHidden ? tag('active') : '-'}</td>
          </tr>${hasContent ? `<tr id="file-content-${i}" class="hidden"><td colspan="4" style="padding:0"><pre class="json-preview" style="margin:0;border:none;border-radius:0;max-height:400px;">${escHtml(f.content)}</pre></td></tr>` : ''}`;
        }).join('')
        + '</tbody></table></div>';

    const linksTable = buildTable(
      [
        { label: 'Direction', key: 'direction', render: r => tag(r.direction === 'out' ? 'outbound' : 'inbound') },
        { label: 'Server', key: 'target', render: r => escHtml(r.target?.name || '-') },
        { label: 'IP', key: 'ip', render: r => escHtml(r.target?.ipAddress || '-') },
        { label: 'Link Type', key: 'linkType', render: r => escHtml(r.linkType || r.type || '-') },
        { label: 'Latency', key: 'latency' },
      ],
      links
    );

    container.innerHTML = `
      <div class="page-header">
        <h2 class="page-title">
          <a href="#" id="back-to-list" style="color:var(--text-muted);text-decoration:none;">&larr; Servers</a>
          / ${escHtml(server.name)}
        </h2>
        <div class="btn-group">
          <button class="btn btn-danger" id="btn-delete-server">Delete</button>
        </div>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">IP</div><div class="stat-value">${escHtml(server.ipAddress)}</div></div>
        <div class="stat-card"><div class="stat-label">Type</div><div class="stat-value">${escHtml(server.type || '-')}</div></div>
        <div class="stat-card"><div class="stat-label">Role</div><div class="stat-value">${escHtml(server.role || '-')}</div></div>
        <div class="stat-card"><div class="stat-label">Security</div><div class="stat-value">${server.securityLevel ?? '-'}</div></div>
        <div class="stat-card"><div class="stat-label">Firewall</div><div class="stat-value">${server.firewallLevel ?? '-'}</div></div>
        <div class="stat-card"><div class="stat-label">Encryption</div><div class="stat-value">${server.encryptionLevel ?? '-'}</div></div>
        <div class="stat-card"><div class="stat-label">Status</div><div class="stat-value">${tag(server.isOnline ? 'online' : 'offline')}</div></div>
        <div class="stat-card"><div class="stat-label">Access</div><div class="stat-value">${escHtml(server.accessMethod || '-')}</div></div>
      </div>

      <div class="section">
        <div class="page-header">
          <h3 class="section-title">Files (${files.length})</h3>
          <button class="btn btn-small btn-primary" id="btn-add-file">+ Add File</button>
        </div>
        ${filesHtml}
      </div>

      <div class="section">
        <div class="page-header">
          <h3 class="section-title">Links (${links.length})</h3>
          <button class="btn btn-small btn-primary" id="btn-add-link">+ Add Link</button>
        </div>
        ${linksTable}
      </div>
    `;

    container.querySelector('#back-to-list').addEventListener('click', (e) => {
      e.preventDefault();
      renderList(container);
    });

    container.querySelector('#btn-delete-server').addEventListener('click', async () => {
      if (!confirm(`Delete server "${server.name}"? This cannot be undone.`)) return;
      try {
        await api.deleteServer(id);
        toast('Server deleted', 'success');
        renderList(container);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    container.querySelector('#btn-add-file').addEventListener('click', () => showAddFileModal(container, server));
    container.querySelector('#btn-add-link').addEventListener('click', () => showAddLinkModal(container, server));

    // Toggle file content rows on click
    container.querySelectorAll('[data-file-idx]').forEach(tr => {
      tr.addEventListener('click', () => {
        const contentRow = document.getElementById(`file-content-${tr.dataset.fileIdx}`);
        if (contentRow) contentRow.classList.toggle('hidden');
      });
    });
  } catch (err) {
    toast(err.message, 'error');
    renderList(container);
  }
}

function showAddFileModal(container, server) {
  const files = server.files || [];
  const dirOpts = files.filter(f => f.type === 'directory').map(f => ({ value: f.id, label: f.name }));

  const body = `
    <div class="form-row">${formField('Name', 'name', 'text', '', { required: true })}</div>
    <div class="form-row">${formField('Type', 'type', 'select', 'file', { options: [
      { value: 'file', label: 'File' }, { value: 'directory', label: 'Directory' },
    ] })}</div>
    <div class="form-row">${formField('Content', 'content', 'textarea')}</div>
    <div class="form-row">${formField('Parent Directory', 'parentId', 'select', '', { options: dirOpts, placeholder: 'Root (none)' })}</div>
    <div class="form-row">${formField('Hidden', 'isHidden', 'checkbox', false, { checkLabel: 'Hidden file' })}</div>
  `;

  const footer = `
    <button class="btn" id="modal-cancel">Cancel</button>
    <button class="btn btn-primary" id="modal-save">Add File</button>
  `;

  openModal('Add File', body, footer);

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', async () => {
    try {
      const formData = readForm(document.getElementById('modal-body'));
      await api.createServerFile(server.id, formData);
      closeModal();
      toast('File added', 'success');
      renderDetail(container, server.id);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function showAddLinkModal(container, server) {
  let servers = [];
  try {
    const res = await api.getServers('limit=200');
    servers = (res.data || []).filter(s => s.id !== server.id);
  } catch { /* proceed empty */ }

  const serverOpts = servers.map(s => ({ value: s.id, label: `${s.name} (${s.ipAddress})` }));

  const body = `
    <div class="form-row">${formField('Target Server', 'targetId', 'select', '', { options: serverOpts, placeholder: 'Select target...' })}</div>
    <div class="form-row">${formField('Link Type', 'linkType', 'select', 'lan', { options: [
      { value: 'lan', label: 'LAN' }, { value: 'wan', label: 'WAN' },
      { value: 'vpn', label: 'VPN' }, { value: 'backbone', label: 'Backbone' },
      { value: 'hidden', label: 'Hidden' },
    ]})}</div>
    <div class="form-row">${formField('Latency (ms)', 'latency', 'number', '10')}</div>
    <div class="form-row">${formField('Required Access Level', 'requiredAccess', 'number', '0')}</div>
  `;

  const footer = `
    <button class="btn" id="modal-cancel">Cancel</button>
    <button class="btn btn-primary" id="modal-save">Add Link</button>
  `;

  openModal('Add Link', body, footer);

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', async () => {
    try {
      const formData = readForm(document.getElementById('modal-body'));
      await api.createServerLink(server.id, formData);
      closeModal();
      toast('Link added', 'success');
      renderDetail(container, server.id);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

export default async function render(container, serverId) {
  if (serverId) {
    // Direct link to server detail (e.g. from networks page)
    await renderDetail(container, serverId);
  } else {
    currentPage = 1;
    filterType = '';
    searchQuery = '';
    await renderList(container);
  }
}
