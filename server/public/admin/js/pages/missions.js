import * as api from '../api.js';
import { toast, openModal, closeModal, tag, escHtml, buildTable, buildPagination, formField, readForm, timeAgo } from '../ui.js';

let currentPage = 1;
let filterStatus = '';
let filterType = '';

// Mission types
const MISSION_TYPES = ['tutorial', 'faction', 'side', 'story', 'daily', 'bounty', 'dungeon'];

// Objective types grouped by category with their progress type
const OBJECTIVE_TYPES = {
  'Action': [
    { value: 'hack', label: 'Hack (any server)', progress: 'count' },
    { value: 'hack_target', label: 'Hack specific server', progress: 'boolean', meta: ['serverId'] },
    { value: 'hack_stealth', label: 'Hack undetected', progress: 'count' },
    { value: 'hack_method', label: 'Hack with method', progress: 'count', meta: ['method'] },
    { value: 'gain_access', label: 'Gain access level', progress: 'boolean', meta: ['serverId', 'minLevel'] },
    { value: 'install_backdoor', label: 'Install backdoor', progress: 'boolean', meta: ['serverId'] },
  ],
  'File': [
    { value: 'steal', label: 'Read/download specific file', progress: 'boolean', meta: ['fileId'] },
    { value: 'steal_count', label: 'Download multiple files', progress: 'count', meta: ['serverId'] },
    { value: 'upload_file', label: 'Upload to server', progress: 'boolean', meta: ['serverId'] },
    { value: 'delete_file', label: 'Delete file', progress: 'boolean', meta: ['fileId'] },
    { value: 'download_file', label: 'Download a file', progress: 'boolean', meta: ['fileId'] },
    { value: 'exfiltrate_data', label: 'Exfiltrate from server', progress: 'boolean', meta: ['serverId', 'fileId'] },
  ],
  'Social': [
    { value: 'message', label: 'Send messages', progress: 'count' },
    { value: 'contact_player', label: 'Contact player', progress: 'boolean', meta: ['recipientId'] },
  ],
  'Forum': [
    { value: 'forum_post', label: 'Create posts', progress: 'count' },
    { value: 'forum_reply', label: 'Reply to thread', progress: 'boolean', meta: ['threadId'] },
    { value: 'forum_interaction', label: 'Any forum activity', progress: 'count' },
  ],
  'Exploration': [
    { value: 'explore', label: 'Connect to servers', progress: 'count' },
    { value: 'connect_server', label: 'Connect to specific server', progress: 'boolean', meta: ['serverId'] },
    { value: 'discover_server_type', label: 'Discover server type', progress: 'count', meta: ['serverType'] },
    { value: 'infiltrate_network', label: 'Infiltrate network', progress: 'boolean', meta: ['networkId'] },
    { value: 'trace_connection', label: 'Trace connection', progress: 'boolean', meta: ['serverId'] },
  ],
  'Progression': [
    { value: 'skill_level', label: 'Reach skill level', progress: 'count', meta: ['skill'] },
    { value: 'gain_xp', label: 'Gain XP', progress: 'count' },
    { value: 'earn_credits', label: 'Earn credits', progress: 'count' },
    { value: 'spend_credits', label: 'Spend credits', progress: 'count' },
  ],
  'Faction': [
    { value: 'join_faction', label: 'Join faction', progress: 'boolean', meta: ['factionId'] },
    { value: 'faction_choice', label: 'Choose faction/neutral', progress: 'boolean' },
    { value: 'faction_reputation', label: 'Gain reputation', progress: 'count', meta: ['factionId'] },
    { value: 'faction_mission', label: 'Complete faction missions', progress: 'count', meta: ['factionId'] },
  ],
  'Intel': [
    { value: 'report_intel', label: 'Report intel', progress: 'count', meta: ['reportType'] },
  ],
  'Other': [
    { value: 'decode_content', label: 'Decode content', progress: 'boolean', meta: ['encoding'] },
    { value: 'defend_home', label: 'Upgrade defense', progress: 'boolean', meta: ['defenseType'] },
    { value: 'claim_bounty', label: 'Claim bounty', progress: 'boolean' },
    { value: 'survive_trace', label: 'Evade trace', progress: 'count' },
    { value: 'scan_subnet', label: 'Scan subnet', progress: 'count' },
  ],
};

// Flat lookup
const ALL_OBJECTIVES = Object.values(OBJECTIVE_TYPES).flat();

function getObjDef(type) {
  return ALL_OBJECTIVES.find(o => o.value === type);
}

async function renderList(container) {
  try {
    const params = new URLSearchParams({ page: currentPage, limit: 25 });
    if (filterStatus) params.set('status', filterStatus);
    if (filterType) params.set('type', filterType);

    const res = await api.getMissions(params.toString());
    const missions = res.data || [];
    const total = res.total || missions.length;

    const tableHtml = buildTable(
      [
        { label: 'Title', key: 'title' },
        { label: 'Type', key: 'type', render: r => tag(r.type || '-') },
        { label: 'Difficulty', key: 'difficulty' },
        { label: 'Status', key: 'status', render: r => tag(r.status) },
        { label: 'Faction', key: 'faction', render: r => escHtml(r.faction?.name || r.factionId || '-') },
        { label: 'Assignee', key: 'assignee', render: r => escHtml(r.assignee?.username || r.assignedTo || '-') },
        { label: 'Created', key: 'createdAt', render: r => timeAgo(r.createdAt) },
      ],
      missions,
      (row) => `
        <button class="btn btn-small" data-action="edit" data-id="${row.id}">Edit</button>
        <button class="btn btn-small btn-danger" data-action="delete" data-id="${row.id}">Delete</button>
      `
    );

    container.innerHTML = `
      <div class="page-header">
        <h2 class="page-title">Missions</h2>
        <button class="btn btn-primary" id="btn-create-mission">+ Create Mission</button>
      </div>
      <div class="toolbar">
        <select id="filter-status">
          <option value="">All Statuses</option>
          <option value="active" ${filterStatus === 'active' ? 'selected' : ''}>Active</option>
          <option value="available" ${filterStatus === 'available' ? 'selected' : ''}>Available</option>
          <option value="completed" ${filterStatus === 'completed' ? 'selected' : ''}>Completed</option>
          <option value="expired" ${filterStatus === 'expired' ? 'selected' : ''}>Expired</option>
        </select>
        <select id="filter-type-select">
          <option value="">All Types</option>
          ${MISSION_TYPES.map(t => `<option value="${t}" ${filterType === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      ${tableHtml}
      ${buildPagination(currentPage, 25, total)}
    `;

    container.querySelector('#btn-create-mission').addEventListener('click', () => showModal(container, null));

    container.querySelector('#filter-status').addEventListener('change', (e) => {
      filterStatus = e.target.value;
      currentPage = 1;
      renderList(container);
    });

    container.querySelector('#filter-type-select').addEventListener('change', (e) => {
      filterType = e.target.value;
      currentPage = 1;
      renderList(container);
    });

    container.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (action === 'edit') {
        try {
          const mRes = await api.getMission(id);
          showModal(container, mRes.data);
        } catch (err) {
          toast(err.message, 'error');
        }
      } else if (action === 'delete') {
        if (!confirm('Delete this mission?')) return;
        try {
          await api.deleteMission(id);
          toast('Mission deleted', 'success');
          renderList(container);
        } catch (err) {
          toast(err.message, 'error');
        }
      }
    });

    container.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.page);
        if (p >= 1) { currentPage = p; renderList(container); }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Error loading missions</p></div>`;
    toast(err.message, 'error');
  }
}

function buildObjectiveRow(idx, obj) {
  const typeOptions = Object.entries(OBJECTIVE_TYPES).map(([group, types]) =>
    `<optgroup label="${group}">${types.map(t =>
      `<option value="${t.value}" ${obj?.type === t.value ? 'selected' : ''}>${t.label}</option>`
    ).join('')}</optgroup>`
  ).join('');

  const def = obj ? getObjDef(obj.type) : null;
  const isCount = def ? def.progress === 'count' : true;
  const metaFields = def?.meta || [];

  // Build metadata inputs for known fields
  const metaHtml = metaFields.map(key => {
    const val = obj?.metadata?.[key] || '';
    return `<div class="form-group" style="flex:1;min-width:120px;">
      <label class="form-label">${key}</label>
      <input type="text" name="obj_meta_${idx}_${key}" value="${escHtml(val)}" placeholder="${key}">
    </div>`;
  }).join('');

  return `
    <div class="objective-row" data-obj-idx="${idx}" style="border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:8px;background:var(--bg-input);">
      <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;">
        <div class="form-group" style="flex:2;min-width:180px;">
          <label class="form-label">Objective Type</label>
          <select name="obj_type_${idx}" class="obj-type-select" data-idx="${idx}">${typeOptions}</select>
        </div>
        <div class="form-group" style="flex:2;min-width:180px;">
          <label class="form-label">Description</label>
          <input type="text" name="obj_desc_${idx}" value="${escHtml(obj?.description || def?.label || '')}" placeholder="What the player must do">
        </div>
        <div class="form-group" style="flex:1;min-width:80px;">
          <label class="form-label">Target</label>
          <input type="${isCount ? 'number' : 'text'}" name="obj_target_${idx}" value="${obj ? obj.target : (isCount ? '1' : 'true')}" placeholder="${isCount ? 'count' : 'true'}">
        </div>
        <button type="button" class="btn btn-small btn-danger remove-obj" data-idx="${idx}" style="margin-bottom:14px;">X</button>
      </div>
      ${metaFields.length > 0 ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">${metaHtml}</div>` : ''}
    </div>
  `;
}

function showModal(container, mission) {
  const isEdit = !!mission;
  const objectives = mission?.objectives || [];
  const reward = mission?.reward || {};

  // Mission type select options
  const typeOptions = MISSION_TYPES.map(t =>
    `<option value="${t}" ${mission?.type === t ? 'selected' : ''}>${t}</option>`
  ).join('');

  const objectivesHtml = objectives.length > 0
    ? objectives.map((obj, i) => buildObjectiveRow(i, obj)).join('')
    : buildObjectiveRow(0, null);

  const body = `
    <div class="form-group">
      <label class="form-label">Title</label>
      <input type="text" name="title" value="${escHtml(mission?.title || '')}" required>
    </div>
    <div class="form-group">
      <label class="form-label">Description</label>
      <textarea name="description">${escHtml(mission?.description || '')}</textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Type</label>
        <select name="type">${typeOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Difficulty (1-10)</label>
        <input type="number" name="difficulty" min="1" max="10" value="${mission?.difficulty ?? 3}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Faction ID <span style="color:var(--text-muted)">(optional)</span></label>
      <input type="text" name="factionId" value="${escHtml(mission?.factionId || '')}" placeholder="Leave empty for no faction">
    </div>

    <div class="section" style="margin-top:16px;">
      <h3 class="section-title">Rewards</h3>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">XP</label>
          <input type="number" name="reward_xp" min="0" value="${reward.xp ?? 100}">
        </div>
        <div class="form-group">
          <label class="form-label">Credits</label>
          <input type="number" name="reward_credits" min="0" value="${reward.credits ?? 200}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Skill Points</label>
          <input type="number" name="reward_skillPoints" min="0" value="${reward.skillPoints ?? 0}">
        </div>
        <div class="form-group">
          <label class="form-label">Reputation</label>
          <input type="number" name="reward_reputation" min="0" value="${reward.reputation ?? 0}">
        </div>
      </div>
    </div>

    <div class="section" style="margin-top:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h3 class="section-title" style="border:none;margin:0;padding:0;">Objectives</h3>
        <button type="button" class="btn btn-small" id="btn-add-objective">+ Add Objective</button>
      </div>
      <div id="objectives-container" style="margin-top:8px;">
        ${objectivesHtml}
      </div>
    </div>
  `;

  const footer = `
    <button class="btn" id="modal-cancel">Cancel</button>
    <button class="btn btn-primary" id="modal-save">${isEdit ? 'Save' : 'Create'}</button>
  `;

  openModal(isEdit ? 'Edit Mission' : 'Create Mission', body, footer);

  let objCount = Math.max(objectives.length, 1);

  // Add objective button
  document.getElementById('btn-add-objective').addEventListener('click', () => {
    const c = document.getElementById('objectives-container');
    c.insertAdjacentHTML('beforeend', buildObjectiveRow(objCount, null));
    objCount++;
  });

  // Remove objective (delegated)
  document.getElementById('modal-body').addEventListener('click', (e) => {
    if (e.target.closest('.remove-obj')) {
      const row = e.target.closest('.objective-row');
      if (document.querySelectorAll('.objective-row').length > 1) {
        row.remove();
      } else {
        toast('At least one objective required', 'error');
      }
    }
  });

  // When objective type changes, update description placeholder and target type
  document.getElementById('modal-body').addEventListener('change', (e) => {
    if (!e.target.classList.contains('obj-type-select')) return;
    const idx = e.target.dataset.idx;
    const def = getObjDef(e.target.value);
    if (!def) return;

    const row = e.target.closest('.objective-row');
    const descInput = row.querySelector(`[name="obj_desc_${idx}"]`);
    const targetInput = row.querySelector(`[name="obj_target_${idx}"]`);

    if (descInput && !descInput.value) descInput.value = def.label;
    if (targetInput) {
      targetInput.type = def.progress === 'count' ? 'number' : 'text';
      if (!targetInput.value || targetInput.value === 'true' || targetInput.value === '1') {
        targetInput.value = def.progress === 'count' ? '1' : 'true';
      }
    }
  });

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', async () => {
    try {
      const body = document.getElementById('modal-body');

      // Read basic fields
      const title = body.querySelector('[name="title"]').value;
      const description = body.querySelector('[name="description"]').value;
      const type = body.querySelector('[name="type"]').value;
      const difficulty = Number(body.querySelector('[name="difficulty"]').value) || 3;
      const factionId = body.querySelector('[name="factionId"]').value || undefined;

      // Build reward
      const reward = {
        xp: Number(body.querySelector('[name="reward_xp"]').value) || 0,
        credits: Number(body.querySelector('[name="reward_credits"]').value) || 0,
        skillPoints: Number(body.querySelector('[name="reward_skillPoints"]').value) || 0,
        reputation: Number(body.querySelector('[name="reward_reputation"]').value) || 0,
      };

      // Build objectives from rows
      const objRows = body.querySelectorAll('.objective-row');
      const builtObjectives = [];
      objRows.forEach((row) => {
        const idx = row.dataset.objIdx;
        const objType = row.querySelector(`[name="obj_type_${idx}"]`)?.value;
        const objDesc = row.querySelector(`[name="obj_desc_${idx}"]`)?.value;
        const objTargetRaw = row.querySelector(`[name="obj_target_${idx}"]`)?.value;

        if (!objType) return;

        const def = getObjDef(objType);
        const isCount = def?.progress === 'count';

        let target;
        if (isCount) {
          target = Number(objTargetRaw) || 1;
        } else {
          target = objTargetRaw === 'false' ? false : true;
        }

        // Collect metadata from meta fields
        const metadata = {};
        if (def?.meta) {
          for (const key of def.meta) {
            const input = row.querySelector(`[name="obj_meta_${idx}_${key}"]`);
            if (input?.value) metadata[key] = input.value;
          }
        }

        builtObjectives.push({
          id: `obj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          type: objType,
          description: objDesc || def?.label || objType,
          target,
          current: isCount ? 0 : false,
          completed: false,
          ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        });
      });

      if (builtObjectives.length === 0) {
        toast('Add at least one objective', 'error');
        return;
      }

      const formData = {
        title,
        description,
        type,
        difficulty,
        reward,
        objectives: builtObjectives,
        ...(factionId ? { factionId } : {}),
      };

      if (isEdit) {
        await api.updateMission(mission.id, formData);
        toast('Mission updated', 'success');
      } else {
        await api.createMission(formData);
        toast('Mission created', 'success');
      }
      closeModal();
      renderList(container);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

export default async function render(container) {
  currentPage = 1;
  filterStatus = '';
  filterType = '';
  await renderList(container);
}
