/**
 * AIDA Admin API Client
 * Handles authentication, CSRF tokens, and all API calls.
 */

let csrfToken = null;

async function fetchCsrf() {
  try {
    const res = await fetch('/api/csrf-token', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      csrfToken = data.csrfToken || data.token;
    }
  } catch { /* ignore */ }
}

function headers(isJson = true) {
  const h = {};
  if (isJson) h['Content-Type'] = 'application/json';
  if (csrfToken) h['X-CSRF-Token'] = csrfToken;
  return h;
}

async function request(method, path, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: headers(!!body),
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(path, opts);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

// ═══ Auth ═══
export async function verifyAuth() {
  try {
    const data = await request('GET', '/api/auth/verify');
    return data.success ? data.user || data.data : null;
  } catch { return null; }
}

export async function login(username, password) {
  await fetchCsrf();
  const data = await request('POST', '/api/auth/login', { username, password });
  await fetchCsrf(); // refresh token after login
  return data;
}

export async function logout() {
  try { await request('POST', '/api/auth/logout'); } catch { /* ok */ }
}

export async function initCsrf() {
  await fetchCsrf();
}

// ═══ Generic CRUD helpers ═══
const get = (path) => request('GET', path);
const post = (path, body) => request('POST', path, body);
const put = (path, body) => request('PUT', path, body);
const del = (path) => request('DELETE', path);

// ═══ Stats ═══
export const getStats = () => get('/api/admin/stats/dashboard');

// ═══ Servers ═══
export const getServers = (params = '') => get(`/api/admin/servers?${params}`);
export const getServer = (id) => get(`/api/admin/servers/${id}`);
export const createServer = (data) => post('/api/admin/servers', data);
export const updateServer = (id, data) => put(`/api/admin/servers/${id}`, data);
export const deleteServer = (id) => del(`/api/admin/servers/${id}`);
export const getServerFiles = (id, params = '') => get(`/api/admin/servers/${id}/files?${params}`);
export const createServerFile = (id, data) => post(`/api/admin/servers/${id}/files`, data);
export const createServerLink = (id, data) => post(`/api/admin/servers/${id}/links`, data);
export const generateInvestigationChain = (id, data) => post(`/api/admin/servers/${id}/investigation-chain`, data);

// ═══ Networks ═══
export const getNetworks = () => get('/api/admin/networks');
export const getNetwork = (id) => get(`/api/admin/networks/${id}`);
export const createNetwork = (data) => post('/api/admin/networks', data);
export const updateNetwork = (id, data) => put(`/api/admin/networks/${id}`, data);
export const deleteNetwork = (id) => del(`/api/admin/networks/${id}`);

// ═══ Missions ═══
export const getMissions = (params = '') => get(`/api/admin/missions?${params}`);
export const getMission = (id) => get(`/api/admin/missions/${id}`);
export const createMission = (data) => post('/api/admin/missions', data);
export const updateMission = (id, data) => put(`/api/admin/missions/${id}`, data);
export const deleteMission = (id) => del(`/api/admin/missions/${id}`);

// ═══ Forums ═══
export const getForums = () => get('/api/admin/forums');
export const getForum = (id) => get(`/api/admin/forums/${id}`);
export const createForum = (data) => post('/api/admin/forums', data);
export const updateForum = (id, data) => put(`/api/admin/forums/${id}`, data);
export const deleteForum = (id) => del(`/api/admin/forums/${id}`);
export const createForumPost = (forumId, data) => post(`/api/admin/forums/${forumId}/posts`, data);

// ═══ Epochs ═══
export const getEpochs = () => get('/api/admin/epochs');
export const getEpoch = (id) => get(`/api/admin/epochs/${id}`);
export const createEpoch = (data) => post('/api/admin/epochs', data);
export const updateEpoch = (id, data) => put(`/api/admin/epochs/${id}`, data);
export const activateEpoch = (id) => post(`/api/admin/epochs/${id}/activate`);
export const completeEpoch = (id) => post(`/api/admin/epochs/${id}/complete`);
export const getEpochEvents = (id) => get(`/api/admin/epochs/${id}/events`);
export const createEpochEvent = (epochId, data) => post(`/api/admin/epochs/${epochId}/events`, data);
export const updateEpochEvent = (epochId, eventId, data) => put(`/api/admin/epochs/${epochId}/events/${eventId}`, data);
export const deleteEpochEvent = (epochId, eventId) => del(`/api/admin/epochs/${epochId}/events/${eventId}`);
export const fireEpochEvent = (epochId, eventId) => post(`/api/admin/epochs/${epochId}/events/${eventId}/fire`);

// ═══ Drafts ═══
export const getDrafts = (params = '') => get(`/api/admin/drafts?${params}`);
export const getDraft = (id) => get(`/api/admin/drafts/${id}`);
export const approveDraft = (id, reviewNote) => post(`/api/admin/drafts/${id}/approve`, { reviewNote });
export const rejectDraft = (id, reviewNote) => post(`/api/admin/drafts/${id}/reject`, { reviewNote });
export const deleteDraft = (id) => del(`/api/admin/drafts/${id}`);

// ═══ Players ═══
export const getPlayers = (params = '') => get(`/api/admin/players?${params}`);
export const getPlayer = (id) => get(`/api/admin/players/${id}`);
export const updatePlayerProgress = (id, data) => put(`/api/admin/players/${id}/progress`, data);
export const updatePlayerRole = (id, role) => put(`/api/admin/players/${id}/role`, { role });
