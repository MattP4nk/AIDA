import * as api from '../api.js';
import { toast, openModal, closeModal, tag, escHtml, buildTable, buildPagination, formField, readForm, timeAgo } from '../ui.js';

let currentPage = 1;
let searchQuery = '';

async function renderList(container) {
  try {
    const params = new URLSearchParams({ page: currentPage, limit: 25 });
    if (searchQuery) params.set('search', searchQuery);

    const res = await api.getPlayers(params.toString());
    const players = res.data || [];
    const total = res.total || players.length;

    const tableHtml = buildTable(
      [
        { label: 'Username', key: 'username' },
        { label: 'Level', key: 'level', render: r => r.progress?.level ?? r.level ?? '-' },
        { label: 'Credits', key: 'credits', render: r => r.progress?.credits ?? r.credits ?? '-' },
        { label: 'XP', key: 'experience', render: r => r.progress?.experience ?? r.experience ?? '-' },
        { label: 'Role', key: 'role', render: r => tag(r.role) },
        { label: 'Created', key: 'createdAt', render: r => timeAgo(r.createdAt) },
      ],
      players
    );

    container.innerHTML = `
      <div class="page-header">
        <h2 class="page-title">Players</h2>
      </div>
      <div class="toolbar">
        <input type="text" id="search-input" placeholder="Search by username..." value="${escHtml(searchQuery)}">
      </div>
      ${tableHtml}
      ${buildPagination(currentPage, 25, total)}
    `;

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
      tr.addEventListener('click', () => renderDetail(container, players[i].id));
    });

    // Pagination
    container.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.page);
        if (p >= 1) { currentPage = p; renderList(container); }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Error loading players</p></div>`;
    toast(err.message, 'error');
  }
}

async function renderDetail(container, playerId) {
  try {
    const res = await api.getPlayer(playerId);
    const player = res.data;
    const progress = player.progress || {};
    const skills = progress.skills || {};
    const missions = player.missions || player.activeMissions || [];
    const faction = player.faction || null;

    const missionsTable = buildTable(
      [
        { label: 'Title', key: 'title', render: r => escHtml(r.title || r.mission?.title || '-') },
        { label: 'Status', key: 'status', render: r => tag(r.status) },
        { label: 'Type', key: 'type', render: r => escHtml(r.type || r.mission?.type || '-') },
      ],
      missions
    );

    container.innerHTML = `
      <div class="page-header">
        <h2 class="page-title">
          <a href="#" id="back-to-list" style="color:var(--text-muted);text-decoration:none;">&larr; Players</a>
          / ${escHtml(player.username)}
        </h2>
        <div class="btn-group">
          <button class="btn btn-primary" id="btn-edit-progress">Edit Progress</button>
          <button class="btn" id="btn-change-role">Change Role</button>
        </div>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">Username</div><div class="stat-value">${escHtml(player.username)}</div></div>
        <div class="stat-card"><div class="stat-label">Role</div><div class="stat-value">${tag(player.role)}</div></div>
        <div class="stat-card"><div class="stat-label">Level</div><div class="stat-value">${progress.level ?? '-'}</div></div>
        <div class="stat-card"><div class="stat-label">Credits</div><div class="stat-value">${progress.credits ?? '-'}</div></div>
        <div class="stat-card"><div class="stat-label">Experience</div><div class="stat-value">${progress.experience ?? '-'}</div></div>
        <div class="stat-card"><div class="stat-label">Faction</div><div class="stat-value">${escHtml(faction?.name || player.factionId || '-')}</div></div>
      </div>

      <div class="section">
        <h3 class="section-title">Skills</h3>
        <div class="stat-grid">
          <div class="stat-card"><div class="stat-label">Hacking</div><div class="stat-value">${skills.hacking ?? progress.hacking ?? '-'}</div></div>
          <div class="stat-card"><div class="stat-label">Networking</div><div class="stat-value">${skills.networking ?? progress.networking ?? '-'}</div></div>
          <div class="stat-card"><div class="stat-label">Cryptography</div><div class="stat-value">${skills.cryptography ?? progress.cryptography ?? '-'}</div></div>
          <div class="stat-card"><div class="stat-label">Stealth</div><div class="stat-value">${skills.stealth ?? progress.stealth ?? '-'}</div></div>
          <div class="stat-card"><div class="stat-label">Social Eng.</div><div class="stat-value">${skills.socialEng ?? progress.socialEng ?? '-'}</div></div>
          <div class="stat-card"><div class="stat-label">Forensics</div><div class="stat-value">${skills.forensics ?? progress.forensics ?? '-'}</div></div>
        </div>
      </div>

      <div class="section">
        <h3 class="section-title">Active Missions (${missions.length})</h3>
        ${missionsTable}
      </div>
    `;

    container.querySelector('#back-to-list').addEventListener('click', (e) => {
      e.preventDefault();
      renderList(container);
    });

    container.querySelector('#btn-edit-progress').addEventListener('click', () => showProgressModal(container, player));
    container.querySelector('#btn-change-role').addEventListener('click', () => showRoleModal(container, player));
  } catch (err) {
    toast(err.message, 'error');
    renderList(container);
  }
}

function showProgressModal(container, player) {
  const progress = player.progress || {};
  const skills = progress.skills || {};

  const body = `
    <div class="form-row">${formField('Level', 'level', 'number', progress.level ?? 1)}</div>
    <div class="form-row">${formField('Credits', 'credits', 'number', progress.credits ?? 0)}</div>
    <div class="form-row">${formField('Experience', 'experience', 'number', progress.experience ?? 0)}</div>
    <div class="form-row">${formField('Hacking', 'hacking', 'number', skills.hacking ?? progress.hacking ?? 0)}</div>
    <div class="form-row">${formField('Networking', 'networking', 'number', skills.networking ?? progress.networking ?? 0)}</div>
    <div class="form-row">${formField('Cryptography', 'cryptography', 'number', skills.cryptography ?? progress.cryptography ?? 0)}</div>
    <div class="form-row">${formField('Stealth', 'stealth', 'number', skills.stealth ?? progress.stealth ?? 0)}</div>
    <div class="form-row">${formField('Social Engineering', 'socialEng', 'number', skills.socialEng ?? progress.socialEng ?? 0)}</div>
    <div class="form-row">${formField('Forensics', 'forensics', 'number', skills.forensics ?? progress.forensics ?? 0)}</div>
  `;

  const footer = `
    <button class="btn" id="modal-cancel">Cancel</button>
    <button class="btn btn-primary" id="modal-save">Save Progress</button>
  `;

  openModal('Edit Progress', body, footer);

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', async () => {
    try {
      const formData = readForm(document.getElementById('modal-body'));
      await api.updatePlayerProgress(player.id, formData);
      closeModal();
      toast('Progress updated', 'success');
      renderDetail(container, player.id);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function showRoleModal(container, player) {
  const body = `
    <div class="form-row">${formField('Role', 'role', 'select', player.role || 'player', { options: [
      { value: 'player', label: 'Player' },
      { value: 'moderator', label: 'Moderator' },
      { value: 'admin', label: 'Admin' },
    ] })}</div>
  `;

  const footer = `
    <button class="btn" id="modal-cancel">Cancel</button>
    <button class="btn btn-primary" id="modal-save">Change Role</button>
  `;

  openModal('Change Role', body, footer);

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', async () => {
    try {
      const formData = readForm(document.getElementById('modal-body'));
      await api.updatePlayerRole(player.id, formData.role);
      closeModal();
      toast('Role updated', 'success');
      renderDetail(container, player.id);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

export default async function render(container) {
  currentPage = 1;
  searchQuery = '';
  await renderList(container);
}
