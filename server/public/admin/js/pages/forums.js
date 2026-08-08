import * as api from '../api.js';
import { toast, openModal, closeModal, tag, escHtml, buildTable, formField, readForm, timeAgo } from '../ui.js';

async function renderList(container) {
  try {
    const res = await api.getForums();
    const forums = res.data || [];

    const tableHtml = buildTable(
      [
        { label: 'Name', key: 'name' },
        { label: 'URL', key: 'url', render: r => escHtml(r.url || '-') },
        { label: 'Category', key: 'category', render: r => escHtml(r.category || '-') },
        { label: 'Security', key: 'securityLevel' },
        { label: 'Posts', key: 'posts', render: r => (r.posts?.length ?? r._count?.posts ?? 0) },
        { label: 'Faction', key: 'faction', render: r => escHtml(r.faction?.name || '-') },
        { label: 'Honeypot', key: 'isHoneypot', render: r => r.isHoneypot ? tag('warning') : '-' },
      ],
      forums
    );

    container.innerHTML = `
      <div class="page-header">
        <h2 class="page-title">Forums</h2>
        <button class="btn btn-primary" id="btn-create-forum">+ Create Forum</button>
      </div>
      ${tableHtml}
    `;

    container.querySelector('#btn-create-forum').addEventListener('click', () => showCreateModal(container));

    container.querySelectorAll('.data-table tbody tr').forEach((tr, i) => {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => renderDetail(container, forums[i].id));
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Error loading forums</p></div>`;
    toast(err.message, 'error');
  }
}

function showCreateModal(container) {
  const body = `
    <div class="form-row">${formField('Name', 'name', 'text', '', { required: true })}</div>
    <div class="form-row">${formField('URL', 'url', 'text', '', { required: true })}</div>
    <div class="form-row">${formField('Description', 'description', 'textarea')}</div>
    <div class="form-row">${formField('Category', 'category', 'text')}</div>
    <div class="form-row">${formField('Security Level', 'securityLevel', 'number', '0')}</div>
    <div class="form-row">${formField('Honeypot', 'isHoneypot', 'checkbox', false, { checkLabel: 'Is honeypot' })}</div>
    <div class="form-row">${formField('Requires Proxy', 'requiresProxy', 'checkbox', false, { checkLabel: 'Requires proxy' })}</div>
    <div class="form-row">${formField('Faction ID', 'factionId', 'text', '', { placeholder: 'Optional' })}</div>
  `;

  const footer = `
    <button class="btn" id="modal-cancel">Cancel</button>
    <button class="btn btn-primary" id="modal-save">Create</button>
  `;

  openModal('Create Forum', body, footer);

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', async () => {
    try {
      const formData = readForm(document.getElementById('modal-body'));
      await api.createForum(formData);
      closeModal();
      toast('Forum created', 'success');
      renderList(container);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function renderDetail(container, forumId) {
  try {
    const res = await api.getForum(forumId);
    const forum = res.data;
    const posts = forum.posts || [];

    const postsHtml = posts.length === 0
      ? '<div class="empty-state"><p>No posts found</p></div>'
      : posts.map((p, i) => `
        <div class="stat-card" style="cursor:pointer;margin-bottom:8px;" data-post-idx="${i}">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${escHtml(p.title)}</strong>
            <span style="color:var(--text-muted);font-size:11px;">${escHtml(p.authorHandle || '-')} &middot; ${timeAgo(p.createdAt)} ${p.isPinned ? ' &middot; Pinned' : ''}${p.isSticky ? ' &middot; Sticky' : ''}</span>
          </div>
          <div id="post-content-${i}" class="hidden" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);white-space:pre-wrap;font-size:12px;color:var(--text-secondary);">${escHtml(p.content || '')}</div>
        </div>
      `).join('');

    container.innerHTML = `
      <div class="page-header">
        <h2 class="page-title">
          <a href="#" id="back-to-list" style="color:var(--text-muted);text-decoration:none;">&larr; Forums</a>
          / ${escHtml(forum.name)}
        </h2>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">URL</div><div class="stat-value">${escHtml(forum.url || '-')}</div></div>
        <div class="stat-card"><div class="stat-label">Category</div><div class="stat-value">${escHtml(forum.category || '-')}</div></div>
        <div class="stat-card"><div class="stat-label">Security Level</div><div class="stat-value">${forum.securityLevel ?? '-'}</div></div>
        <div class="stat-card"><div class="stat-label">Honeypot</div><div class="stat-value">${forum.isHoneypot ? tag('warning') : 'No'}</div></div>
        <div class="stat-card"><div class="stat-label">Requires Proxy</div><div class="stat-value">${forum.requiresProxy ? 'Yes' : 'No'}</div></div>
        <div class="stat-card"><div class="stat-label">Faction</div><div class="stat-value">${escHtml(forum.faction?.name || '-')}</div></div>
      </div>
      ${forum.description ? `<div class="section"><h3 class="section-title">Description</h3><p>${escHtml(forum.description)}</p></div>` : ''}
      <div class="section">
        <div class="page-header">
          <h3 class="section-title">Posts (${posts.length})</h3>
          <button class="btn btn-small btn-primary" id="btn-new-post">+ New Post</button>
        </div>
        ${postsHtml}
      </div>
    `;

    container.querySelector('#back-to-list').addEventListener('click', (e) => {
      e.preventDefault();
      renderList(container);
    });

    // Toggle post content on click
    container.querySelectorAll('[data-post-idx]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = el.dataset.postIdx;
        const content = document.getElementById(`post-content-${idx}`);
        if (content) content.classList.toggle('hidden');
      });
    });

    container.querySelector('#btn-new-post').addEventListener('click', () => showPostModal(container, forum));
  } catch (err) {
    toast(err.message, 'error');
    renderList(container);
  }
}

function showPostModal(container, forum) {
  const body = `
    <div class="form-row">${formField('Author ID', 'authorId', 'text', '', { required: true })}</div>
    <div class="form-row">${formField('Author Handle', 'authorHandle', 'text', '', { required: true })}</div>
    <div class="form-row">${formField('Title', 'title', 'text', '', { required: true })}</div>
    <div class="form-row">${formField('Content', 'content', 'textarea', '')}</div>
    <div class="form-row">${formField('Tags (comma-separated)', 'tags', 'text', '', { placeholder: 'tag1, tag2, tag3' })}</div>
    <div class="form-row">${formField('Sticky', 'isSticky', 'checkbox', false, { checkLabel: 'Sticky post' })}</div>
    <div class="form-row">${formField('Pinned', 'isPinned', 'checkbox', false, { checkLabel: 'Pin post' })}</div>
  `;

  const footer = `
    <button class="btn" id="modal-cancel">Cancel</button>
    <button class="btn btn-primary" id="modal-save">Create Post</button>
  `;

  openModal('New Post', body, footer);

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', async () => {
    try {
      const formData = readForm(document.getElementById('modal-body'));
      // Convert comma-separated tags to array
      if (formData.tags && typeof formData.tags === 'string') {
        formData.tags = formData.tags.split(',').map(t => t.trim()).filter(Boolean);
      }
      await api.createForumPost(forum.id, formData);
      closeModal();
      toast('Post created', 'success');
      renderDetail(container, forum.id);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

export default async function render(container) {
  await renderList(container);
}
