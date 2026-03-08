const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof data === 'string' ? data : (data.error_description || data.error || 'Request failed');
    throw new Error(message);
  }

  return data;
}

function setMessage(selector, message, type = '') {
  const el = $(selector);
  if (!el) return;
  el.textContent = message || '';
  el.classList.remove('error', 'success');
  if (type) el.classList.add(type);
}

function getQueryParam(name) {
  return new URL(window.location.href).searchParams.get(name);
}

async function loadWeglot() {
  const config = window.AUTHBRIDGE_CONFIG || {};
  if (!config.weglotApiKey) return;

  const script = document.createElement('script');
  script.src = 'https://cdn.weglot.com/weglot.min.js';
  script.async = true;
  script.onload = () => {
    if (window.Weglot) {
      window.Weglot.initialize({
        api_key: config.weglotApiKey
      });
    }
  };
  document.head.appendChild(script);
}

async function loadMe() {
  try {
    return await api('/api/me', { method: 'GET' });
  } catch {
    return null;
  }
}

async function initLogin() {
  const form = $('#login-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setMessage('#message', 'Logging in…');

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    try {
      await api('/api/login', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      setMessage('#message', 'Logged in successfully.', 'success');
      const next = getQueryParam('next');
      window.location.href = next || '/dashboard';
    } catch (error) {
      setMessage('#message', error.message, 'error');
    }
  });
}

async function initSignup() {
  const form = $('#signup-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setMessage('#message', 'Creating account…');

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    try {
      await api('/api/signup', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      setMessage('#message', 'Account created. Redirecting to your dashboard…', 'success');
      const next = getQueryParam('next');
      window.location.href = next || '/dashboard';
    } catch (error) {
      setMessage('#message', error.message, 'error');
    }
  });
}

async function initDashboard() {
  const root = $('#dashboard-content');
  if (!root) return;

  const me = await loadMe();

  if (!me?.authenticated) {
    window.location.href = `/login?next=${encodeURIComponent('/dashboard')}`;
    return;
  }

  root.innerHTML = `
    <div class="panel-soft">
      <p><strong>Name:</strong> ${escapeHtml(me.user.name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(me.user.email)}</p>
      <p><strong>Role:</strong> ${escapeHtml(me.user.role)}</p>
      <p><strong>Developer access:</strong> ${me.developer?.status || 'none'}</p>
    </div>
    <div class="panel-soft">
      <p>Your auth issuer URL:</p>
      <code class="code">${escapeHtml(window.location.origin)}</code>
    </div>
  `;
}

async function initLogout() {
  const button = $('#logout-button');
  if (!button) return;

  button.addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } finally {
      window.location.href = '/';
    }
  });
}

async function initDeveloper() {
  const statusRoot = $('#developer-status');
  const requestForm = $('#developer-request-form');
  const clientForm = $('#client-form');
  const clientList = $('#client-list');
  if (!statusRoot || !requestForm || !clientForm || !clientList) return;

  const me = await loadMe();
  if (!me?.authenticated) {
    window.location.href = `/login?next=${encodeURIComponent('/developer')}`;
    return;
  }

  const refresh = async () => {
    const status = await api('/api/developer/status', { method: 'GET' });

    const devStatus = status.developer_request?.status || 'none';
    statusRoot.innerHTML = `
      <div class="panel-soft">
        <p><strong>User:</strong> ${escapeHtml(me.user.email)}</p>
        <p><strong>Status:</strong> ${escapeHtml(devStatus)}</p>
        ${status.developer_request?.review_note ? `<p><strong>Review note:</strong> ${escapeHtml(status.developer_request.review_note)}</p>` : ''}
      </div>
    `;

    if (devStatus === 'pending' || devStatus === 'approved') {
      requestForm.style.display = 'none';
    } else {
      requestForm.style.display = 'grid';
    }

    clientForm.style.display = devStatus === 'approved' ? 'grid' : 'none';
    clientList.innerHTML = '';

    if (status.clients?.length) {
      status.clients.forEach((client) => {
        const wrapper = document.createElement('article');
        wrapper.className = 'panel-soft';
        wrapper.innerHTML = `
          <h3>${escapeHtml(client.name)}</h3>
          <p><strong>Client ID:</strong></p>
          <code class="code">${escapeHtml(client.client_id)}</code>
          <p><strong>Type:</strong> ${escapeHtml(client.client_type)}</p>
          <p><strong>Scopes:</strong> ${escapeHtml((client.allowed_scopes || []).join(' '))}</p>
          <p><strong>Redirect URIs:</strong></p>
          <code class="code">${escapeHtml((client.redirect_uris || []).join('\n'))}</code>
          ${client.client_secret ? `<p><strong>Client secret:</strong> <span class="client-secret">(copy and save it now)</span></p><code class="code">${escapeHtml(client.client_secret)}</code>` : '<p class="small">Public client: no client secret stored.</p>'}
        `;
        clientList.appendChild(wrapper);
      });
    } else {
      clientList.innerHTML = '<p class="muted">No clients yet.</p>';
    }
  };

  await refresh();

  requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setMessage('#developer-request-message', 'Sending request…');

    const formData = new FormData(requestForm);
    const payload = Object.fromEntries(formData.entries());

    try {
      await api('/api/developer/request', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      setMessage('#developer-request-message', 'Request sent. Wait for admin approval.', 'success');
      await refresh();
    } catch (error) {
      setMessage('#developer-request-message', error.message, 'error');
    }
  });

  clientForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setMessage('#client-message', 'Creating OAuth client…');

    const formData = new FormData(clientForm);
    const payload = Object.fromEntries(formData.entries());

    try {
      await api('/api/developer/apps', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      setMessage('#client-message', 'Client created successfully.', 'success');
      clientForm.reset();
      await refresh();
    } catch (error) {
      setMessage('#client-message', error.message, 'error');
    }
  });
}

async function initAdmin() {
  const requestList = $('#request-list');
  const bootstrapForm = $('#bootstrap-admin-form');
  if (!requestList || !bootstrapForm) return;

  bootstrapForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setMessage('#bootstrap-message', 'Creating first admin…');
    const payload = Object.fromEntries(new FormData(bootstrapForm).entries());

    try {
      await api('/api/bootstrap-admin', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setMessage('#bootstrap-message', 'Admin created successfully. You can now log in.', 'success');
    } catch (error) {
      setMessage('#bootstrap-message', error.message, 'error');
    }
  });

  const me = await loadMe();
  if (!me?.authenticated) {
    requestList.innerHTML = '<p class="muted">Login as admin to review requests. The bootstrap form above can create the first admin.</p>';
    return;
  }

  if (me.user.role !== 'admin') {
    requestList.innerHTML = '<p class="message error">You are logged in, but this account is not an admin.</p>';
    return;
  }

  const render = async () => {
    const data = await api('/api/admin/requests', { method: 'GET' });
    requestList.innerHTML = '';

    if (!data.requests.length) {
      requestList.innerHTML = '<p class="muted">No pending requests.</p>';
      return;
    }

    data.requests.forEach((request) => {
      const article = document.createElement('article');
      article.className = 'panel-soft';
      article.innerHTML = `
        <h3>${escapeHtml(request.company_name)}</h3>
        <p><strong>User:</strong> ${escapeHtml(request.user_email)}</p>
        <p><strong>Website:</strong> ${escapeHtml(request.website || '—')}</p>
        <p><strong>Use case:</strong> ${escapeHtml(request.use_case)}</p>
        <div class="actions">
          <button data-review="approved" data-id="${escapeHtml(request.id)}">Approve</button>
          <button data-review="rejected" data-id="${escapeHtml(request.id)}">Reject</button>
        </div>
      `;
      requestList.appendChild(article);
    });

    requestList.querySelectorAll('button[data-review]').forEach((button) => {
      button.addEventListener('click', async () => {
        const status = button.getAttribute('data-review');
        const requestId = button.getAttribute('data-id');
        const review_note = window.prompt(`Optional note for ${status}:`, '') || '';

        await api('/api/admin/review', {
          method: 'POST',
          body: JSON.stringify({ request_id: requestId, status, review_note })
        });

        await render();
      });
    });
  };

  await render();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadWeglot();
  await initLogin();
  await initSignup();
  await initDashboard();
  await initLogout();
  await initDeveloper();
  await initAdmin();
});
