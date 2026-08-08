import * as api from '../api.js';
import { toast, openModal, closeModal, tag, escHtml, buildTable, formField, readForm, timeAgo } from '../ui.js';

let selectedEpochId = null;

async function renderPage(container) {
  try {
    const res = await api.getEpochs();
    const epochs = res.data || [];

    // Auto-select the active epoch, or the first one
    if (!selectedEpochId && epochs.length) {
      const active = epochs.find(e => e.status === 'active');
      selectedEpochId = active ? active.id : epochs[0].id;
    }

    const epochCards = epochs.map(e => `
      <div class="stat-card ${e.id === selectedEpochId ? 'selected' : ''}"
           data-epoch-id="${e.id}"
           style="cursor:pointer; ${e.id === selectedEpochId ? 'border: 2px solid var(--accent); ' : ''}">
        <div class="stat-label">Epoch ${e.epochNum ?? ''}</div>
        <div class="stat-value">${escHtml(e.title || e.name || 'Untitled')}</div>
        <div style="margin-top:4px;">${tag(e.status)} <span style="color:var(--text-muted);font-size:0.85em;">${e._count?.events ?? e.events?.length ?? 0} events</span></div>
      </div>
    `).join('');

    let detailHtml = '';
    if (selectedEpochId) {
      detailHtml = await renderEpochDetail(selectedEpochId);
    }

    container.innerHTML = `
      <div class="page-header">
        <h2 class="page-title">Epochs</h2>
        <button class="btn btn-primary" id="btn-create-epoch">+ New Epoch</button>
      </div>
      <div class="stat-grid" id="epoch-cards" style="margin-bottom:24px;">
        ${epochCards || '<div class="empty-state"><p>No epochs yet</p></div>'}
      </div>
      <div id="epoch-detail">${detailHtml}</div>
    `;

    // Epoch card clicks
    container.querySelectorAll('[data-epoch-id]').forEach(card => {
      card.addEventListener('click', () => {
        selectedEpochId = card.dataset.epochId;
        renderPage(container);
      });
    });

    container.querySelector('#btn-create-epoch').addEventListener('click', () => showEpochModal(container));

    // Wire detail action buttons
    wireDetailListeners(container);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Error loading epochs</p></div>`;
    toast(err.message, 'error');
  }
}

async function renderEpochDetail(epochId) {
  try {
    const [epochRes, eventsRes] = await Promise.all([
      api.getEpoch(epochId),
      api.getEpochEvents(epochId),
    ]);
    const epoch = epochRes.data;
    const events = eventsRes.data || [];

    const eventsTable = buildTable(
      [
        { label: 'Name', key: 'name' },
        { label: 'Trigger', key: 'triggerType', render: r => tag(r.triggerType) },
        { label: 'Scheduled', key: 'scheduledAt', render: r => r.scheduledAt ? new Date(r.scheduledAt).toLocaleString() : '-' },
        { label: 'Status', key: 'status', render: r => tag(r.status) },
      ],
      events,
      (row) => {
        let btns = '';
        if (row.status === 'pending') {
          btns += `<button class="btn btn-small btn-success" data-action="fire" data-event-id="${row.id}">Fire</button> `;
        }
        return btns;
      }
    );

    const actionBtns = [];
    if (epoch.status === 'draft') {
      actionBtns.push(`<button class="btn btn-success" id="btn-activate-epoch">Activate</button>`);
    }
    if (epoch.status === 'active') {
      actionBtns.push(`<button class="btn btn-primary" id="btn-complete-epoch">Complete</button>`);
    }

    return `
      <div class="section">
        <div class="page-header">
          <h3 class="section-title">${escHtml(epoch.title || epoch.name || 'Epoch')}</h3>
          <div class="btn-group">${actionBtns.join(' ')}</div>
        </div>
        ${epoch.description ? `<p style="color:var(--text-muted);margin-bottom:8px;">${escHtml(epoch.description)}</p>` : ''}
        ${epoch.summary ? `<p style="margin-bottom:16px;">${escHtml(epoch.summary)}</p>` : ''}
      </div>
      <div class="section">
        <div class="page-header">
          <h3 class="section-title">Events (${events.length})</h3>
          <button class="btn btn-small btn-primary" id="btn-new-event">+ New Event</button>
        </div>
        ${eventsTable}
      </div>
    `;
  } catch (err) {
    return `<div class="empty-state"><p>Error loading epoch details: ${escHtml(err.message)}</p></div>`;
  }
}

function wireDetailListeners(container) {
  const activateBtn = container.querySelector('#btn-activate-epoch');
  if (activateBtn) {
    activateBtn.addEventListener('click', async () => {
      try {
        await api.activateEpoch(selectedEpochId);
        toast('Epoch activated', 'success');
        renderPage(container);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  const completeBtn = container.querySelector('#btn-complete-epoch');
  if (completeBtn) {
    completeBtn.addEventListener('click', async () => {
      try {
        await api.completeEpoch(selectedEpochId);
        toast('Epoch completed', 'success');
        renderPage(container);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  const newEventBtn = container.querySelector('#btn-new-event');
  if (newEventBtn) {
    newEventBtn.addEventListener('click', () => showEventModal(container));
  }

  container.querySelectorAll('[data-action="fire"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const eventId = btn.dataset.eventId;
      try {
        await api.fireEpochEvent(selectedEpochId, eventId);
        toast('Event fired', 'success');
        renderPage(container);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

function showEpochModal(container) {
  const body = `
    <div class="form-row">${formField('Epoch Number', 'epochNum', 'number', '', { required: true })}</div>
    <div class="form-row">${formField('Title', 'title', 'text', '', { required: true })}</div>
    <div class="form-row">${formField('Description', 'description', 'textarea')}</div>
    <div class="form-row">${formField('Summary', 'summary', 'textarea')}</div>
  `;

  const footer = `
    <button class="btn" id="modal-cancel">Cancel</button>
    <button class="btn btn-primary" id="modal-save">Create</button>
  `;

  openModal('New Epoch', body, footer);

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', async () => {
    try {
      const formData = readForm(document.getElementById('modal-body'));
      const res = await api.createEpoch(formData);
      closeModal();
      toast('Epoch created', 'success');
      selectedEpochId = res.data?.id || selectedEpochId;
      renderPage(container);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function showEventModal(container) {
  const defaultPayload = '{"action":"world_event","title":"","description":""}';

  const body = `
    <div class="form-row">${formField('Name', 'name', 'text', '', { required: true })}</div>
    <div class="form-row">${formField('Description', 'description', 'textarea')}</div>
    <div class="form-row">${formField('Trigger Type', 'triggerType', 'select', 'manual', { options: [
      { value: 'scheduled', label: 'Scheduled' },
      { value: 'manual', label: 'Manual' },
      { value: 'condition', label: 'Condition' },
    ] })}</div>
    <div class="form-row" id="scheduled-row" style="display:none;">${formField('Scheduled At', 'scheduledAt', 'datetime-local')}</div>
    <div class="form-row">${formField('Payload (JSON)', 'payload', 'textarea', defaultPayload)}</div>
  `;

  const footer = `
    <button class="btn" id="modal-cancel">Cancel</button>
    <button class="btn btn-primary" id="modal-save">Create Event</button>
  `;

  openModal('New Event', body, footer);

  // Show/hide scheduled date based on trigger type
  const triggerSelect = document.getElementById('field-triggerType');
  const scheduledRow = document.getElementById('scheduled-row');
  triggerSelect.addEventListener('change', () => {
    scheduledRow.style.display = triggerSelect.value === 'scheduled' ? '' : 'none';
  });

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', async () => {
    try {
      const formData = readForm(document.getElementById('modal-body'));
      // Parse payload JSON
      if (formData.payload) formData.payload = JSON.parse(formData.payload);
      // Remove scheduledAt if not scheduled
      if (formData.triggerType !== 'scheduled') delete formData.scheduledAt;
      await api.createEpochEvent(selectedEpochId, formData);
      closeModal();
      toast('Event created', 'success');
      renderPage(container);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

export default async function render(container) {
  selectedEpochId = null;
  await renderPage(container);
}
