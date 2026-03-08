function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderConsentPage({ appName, scope, user, formAction, hiddenFields }) {
  const fields = Object.entries(hiddenFields)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}" />`)
    .join('\n');

  const scopes = String(scope || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Authorize ${escapeHtml(appName)}</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <main class="container narrow">
    <section class="card stack">
      <a class="brand block" href="/">AuthBridge</a>
      <span class="badge">Consent required</span>
      <h1>Authorize ${escapeHtml(appName)}</h1>
      <p class="muted">Logged in as <strong>${escapeHtml(user.email)}</strong></p>
      <p>This application is requesting permission to access the following scopes:</p>
      <ul class="list">${scopes || '<li>profile</li>'}</ul>

      <form class="stack" action="${escapeHtml(formAction)}" method="post">
        ${fields}
        <div class="actions">
          <button class="button primary" type="submit" name="decision" value="approve">Allow</button>
          <button class="button" type="submit" name="decision" value="deny">Deny</button>
        </div>
      </form>
    </section>
  </main>
  <script src="/config.js"></script>
  <script src="/app.js"></script>
</body>
</html>`;
}
