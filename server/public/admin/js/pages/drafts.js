import * as api from '../api.js';
import { toast, openModal, closeModal, tag, escHtml, buildTable, buildPagination, formField, readForm, timeAgo, truncate } from '../ui.js';

let currentPage = 1;
let filterStatus = '';
let filterType = '';

async function renderList(container) {
  try {
    const params = new URLSearchParams({ page: currentPage, limit: 25 });
    if (filterStatus) params.set('status', filterStatus);
    if (filterType) params.set('type', filterType);

    const res = await api.getDrafts(params.toString());
    const drafts = res.data || [];
    const total = res.total || drafts.length;

    const tableHtml = buildTable(
      [
        { label: 'Title', key: 'title', render: r => escHtml(r.title || r.name || 'Untitled') },
        { label: 'Type', key: 'type', render: r => tag(r.type) },
        { label: 'Source', key: 'source', render: r => escHtml(r.source || '-') },
        { label: 'Status', key: 'status', render: r => tag(r.status) },
        { label: 'Created', key: 'createdAt', render: r => timeAgo(r.createdAt) },
      ],
      drafts
    );

    container.innerHTML = `
      <div class="page-header">
        <h2 class="page-title">Drafts</h2>
      </div>
      <div class="toolbar">
        <select id="filter-status">
          <option value="">All Statuses</option>
          <option value="draft" ${filterStatus === 'draft' ? 'selected' : ''}>Draft</option>
          <option value="approved" ${filterStatus === 'approved' ? 'selected' : ''}>Approved</option>
          <option value="rejected" ${filterStatus === 'rejected' ? 'selected' : ''}>Rejected</option>
          <option value="applied" ${filterStatus === 'applied' ? 'selected' : ''}>Applied</option>
        </select>
        <input type="text" id="filter-type-input" placeholder="Filter by type..." value="${escHtml(filterType)}">
      </div>
      ${tableHtml}
      ${buildPagination(currentPage, 25, total)}
    `;

    container.querySelector('#filter-status').addEventListener('change', (e) => {
      filterStatus = e.target.value;
      currentPage = 1;
      renderList(container);
    });

    container.querySelector('#filter-type-input').addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        filterType = e.target.value;
        currentPage = 1;
        renderList(container);
      }
    });

    // Row clicks for detail
    container.querySelectorAll('.data-table tbody tr').forEach((tr, i) => {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => renderDetail(container, drafts[i].id));
    });

    container.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.page);
        if (p >= 1) { currentPage = p; renderList(container); }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Error loading drafts</p></div>`;
    toast(err.message, 'error');
  }
}

async function renderDetail(container, draftId) {
  try {
    const res = await api.getDraft(draftId);
    const draft = res.data;

    let payloadHtml = '';
    if (draft.payload) {
      const payloadStr = typeof draft.payload === 'string' ? draft.payload : JSON.stringify(draft.payload, null, 2);
      payloadHtml = `
        <div class="section">
          <h3 class="section-title">Payload</h3>
          <pre class="json-preview">${escHtml(payloadStr)}</pre>
        </div>
      `;
    }

    const actionBtns = [];
    if (draft.status === 'draft' || draft.status === 'pending') {
      actionBtns.push(`<button class="btn btn-success" id="btn-approve">Approve</button>`);
      actionBtns.push(`<button class="btn btn-danger" id="btn-reject">Reject</button>`);
    }
    if (draft.status === 'draft' || draft.status === 'rejected') {
      actionBtns.push(`<button class="btn btn-danger" id="btn-delete">Delete</button>`);
    }

    container.innerHTML = `
      <div class="page-header">
        <h2 class="page-title">
          <a href="#" id="back-to-list" style="color:var(--text-muted);text-decoration:none;">&larr; Drafts</a>
          / ${escHtml(draft.title || draft.name || 'Untitled')}
        </h2>
        <div class="btn-group">${actionBtns.join(' ')}</div>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">Type</div><div class="stat-value">${tag(draft.type)}</div></div>
        <div class="stat-card"><div class="stat-label">Source</div><div class="stat-value">${escHtml(draft.source || '-')}</div></div>
        <div class="stat-card"><div class="stat-label">Status</div><div class="stat-value">${tag(draft.status)}</div></div>
        <div class="stat-card"><div class="stat-label">Created</div><div class="stat-value">${timeAgo(draft.createdAt)}</div></div>
      </div>
      ${draft.description ? `<div class="section"><h3 class="section-title">Description</h3><p>${escHtml(draft.description)}</p></div>` : ''}
      ${draft.reviewNote ? `<div class="section"><h3 class="section-title">Review Note</h3><p>${escHtml(draft.reviewNote)}</p></div>` : ''}
      ${payloadHtml}
    `;

    container.querySelector('#back-to-list').addEventListener('click', (e) => {
      e.preventDefault();
      renderList(container);
    });

    const approveBtn = container.querySelector('#btn-approve');
    if (approveBtn) {
      approveBtn.addEventListener('click', async () => {
        const reviewNote = prompt('Review note (optional):') || '';
        try {
          await api.approveDraft(draftId, reviewNote);
          toast('Draft approved', 'success');
          renderDetail(container, draftId);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }

    const rejectBtn = container.querySelector('#btn-reject');
    if (rejectBtn) {
      rejectBtn.addEventListener('click', async () => {
        const reviewNote = prompt('Review note (required):');
        if (!reviewNote) {
          toast('Review note is required for rejection', 'error');
          return;
        }
        try {
          await api.rejectDraft(draftId, reviewNote);
          toast('Draft rejected', 'success');
          renderDetail(container, draftId);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }

    const deleteBtn = container.querySelector('#btn-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (!confirm('Delete this draft?')) return;
        try {
          await api.deleteDraft(draftId);
          toast('Draft deleted', 'success');
          renderList(container);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }
  } catch (err) {
    toast(err.message, 'error');
    renderList(container);
  }
}

export default async function render(container) {
  currentPage = 1;
  filterStatus = '';
  filterType = '';
  await renderList(container);
}
