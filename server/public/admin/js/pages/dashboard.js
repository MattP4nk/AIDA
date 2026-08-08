import * as api from '../api.js';
import { toast, tag, escHtml, buildTable, timeAgo } from '../ui.js';

export default async function render(container) {
  try {
    const res = await api.getStats();
    const data = res.data;

    const stats = [
      { label: 'Players', value: data.playerCount ?? 0 },
      { label: 'Servers', value: data.serverCount ?? 0 },
      { label: 'Networks', value: data.networkCount ?? 0 },
      { label: 'Active Missions', value: data.activeMissionCount ?? 0 },
      { label: 'Forums', value: data.forumCount ?? 0 },
      { label: 'Pending Drafts', value: data.pendingDraftCount ?? 0 },
    ];

    let epochHtml = '';
    if (data.currentEpoch) {
      epochHtml = `
        <div class="section">
          <h3 class="section-title">Current Epoch</h3>
          <div class="stat-grid">
            <div class="stat-card">
              <div class="stat-label">Epoch</div>
              <div class="stat-value">${escHtml(data.currentEpoch.title || data.currentEpoch.name)}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Status</div>
              <div class="stat-value">${tag(data.currentEpoch.status)}</div>
            </div>
          </div>
        </div>`;
    }

    const eventsTable = buildTable(
      [
        { label: 'Type', key: 'type' },
        { label: 'Category', key: 'category' },
        { label: 'Summary', key: 'summary', render: r => escHtml(r.summary || r.description || '') },
        { label: 'Actor', key: 'actor', render: r => escHtml(r.actor || r.actorName || '-') },
        { label: 'Time', key: 'createdAt', render: r => timeAgo(r.createdAt) },
      ],
      data.recentEvents || []
    );

    container.innerHTML = `
      <div class="page-header">
        <h2 class="page-title">Dashboard</h2>
      </div>
      <div class="stat-grid">
        ${stats.map(s => `
          <div class="stat-card">
            <div class="stat-label">${escHtml(s.label)}</div>
            <div class="stat-value">${s.value}</div>
          </div>
        `).join('')}
      </div>
      ${epochHtml}
      <div class="section">
        <h3 class="section-title">Recent Events</h3>
        ${eventsTable}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Failed to load dashboard</p></div>`;
    toast(err.message, 'error');
  }
}
