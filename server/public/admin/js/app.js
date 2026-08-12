/**
 * AIDA Admin Panel — Main Application
 * Initializes auth, router, and page modules.
 */

import * as api from './api.js';
import { registerPage, startRouter } from './router.js';
import { toast } from './ui.js';

// Import page modules
import dashboardPage from './pages/dashboard.js';
import serversPage from './pages/servers.js';
import networksPage from './pages/networks.js';
import missionsPage from './pages/missions.js';
import forumsPage from './pages/forums.js';
import epochsPage from './pages/epochs.js';
import draftsPage from './pages/drafts.js';
import playersPage from './pages/players.js';

let currentUser = null;

// ═══ Auth Flow ═══
async function checkAuth() {
  const user = await api.verifyAuth();
  if (user && user.role === 'admin') {
    currentUser = user;
    showApp();
    return true;
  }
  showLogin();
  return false;
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('admin-username').textContent = currentUser?.username || 'admin';
  updateDraftBadge();
}

async function updateDraftBadge() {
  try {
    const res = await api.getDrafts('status=draft&limit=1');
    const count = res.total || 0;
    const badge = document.getElementById('draft-badge');
    if (count > 0) {
      badge.textContent = count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch { /* ignore */ }
}

// ═══ Login Form ═══
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('login-error');
  errorEl.classList.add('hidden');

  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;

  try {
    await api.login(username, password);
    const user = await api.verifyAuth();
    if (user?.role !== 'admin') {
      errorEl.textContent = 'Access denied: admin role required';
      errorEl.classList.remove('hidden');
      return;
    }
    currentUser = user;
    showApp();
    startRouter('dashboard');
    toast('Authenticated', 'success');
  } catch (err) {
    errorEl.textContent = err.message || 'Authentication failed';
    errorEl.classList.remove('hidden');
  }
});

// ═══ Logout ═══
document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.logout();
  currentUser = null;
  showLogin();
});

// ═══ Register Pages ═══
registerPage('dashboard', dashboardPage);
registerPage('servers', serversPage);
registerPage('networks', networksPage);
registerPage('missions', missionsPage);
registerPage('forums', forumsPage);
registerPage('epochs', epochsPage);
registerPage('drafts', draftsPage);
registerPage('players', playersPage);

// ═══ Init ═══
(async () => {
  await api.initCsrf();
  const authed = await checkAuth();
  if (authed) {
    startRouter('dashboard');
  }
})();

// Refresh draft badge periodically
setInterval(updateDraftBadge, 30000);
