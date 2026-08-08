/**
 * Simple hash-based SPA router for the admin panel.
 */

const routes = {};
let currentPage = null;

export function registerPage(name, renderFn) {
  routes[name] = renderFn;
}

export function navigate(page) {
  if (page !== currentPage) {
    window.location.hash = page;
  }
}

export function getCurrentPage() {
  return currentPage;
}

export function startRouter(defaultPage = 'dashboard') {
  async function handleRoute() {
    const hash = window.location.hash.replace('#', '') || defaultPage;
    const page = hash.split('/')[0]; // support #servers/id sub-routes
    const params = hash.split('/').slice(1);

    currentPage = page;

    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.page === page);
    });

    // Render page
    const container = document.getElementById('page-container');
    if (routes[page]) {
      container.innerHTML = '<div class="loading">Loading</div>';
      try {
        await routes[page](container, ...params);
      } catch (err) {
        container.innerHTML = `<div class="empty-state"><p>Error loading page: ${err.message}</p></div>`;
        console.error('Page render error:', err);
      }
    } else {
      container.innerHTML = '<div class="empty-state"><p>Page not found</p></div>';
    }
  }

  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}
