export const LOGIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#09090b">
<meta name="robots" content="noindex,nofollow">
<title>Sign in · ashercarlow</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: #09090b;
    color: #fafafa;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  main {
    width: 100%;
    max-width: 360px;
  }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 4px; }
  p.sub { color: #a1a1aa; margin: 0 0 24px; font-size: 13px; }
  form { display: flex; flex-direction: column; gap: 12px; }
  input {
    background: #18181b;
    border: 1px solid #27272a;
    border-radius: 8px;
    color: #fafafa;
    font: inherit;
    padding: 11px 14px;
    outline: none;
  }
  input:focus { border-color: #fcd34d; }
  button {
    background: #fcd34d;
    border: none;
    border-radius: 8px;
    color: #09090b;
    font: inherit;
    font-weight: 600;
    padding: 11px 14px;
    cursor: pointer;
  }
  button:hover { background: #fde68a; }
  button:disabled { opacity: 0.5; cursor: default; }
  #status {
    margin: 16px 0 0;
    font-size: 13px;
    min-height: 1em;
  }
  #status.err { color: #f87171; }
  #status.ok { color: #34d399; }
</style>
</head>
<body>
<main>
  <h1>Sign in</h1>
  <p class="sub">Paste the ashercarlow admin token. The session cookie is scoped to <code>.ashercarlow.com</code>.</p>
  <form id="f" autocomplete="off">
    <input type="password" name="token" placeholder="auth token" required autofocus>
    <button type="submit" id="submit">Sign in</button>
  </form>
  <p id="status" aria-live="polite"></p>
</main>
<script>
(function () {
  var apiBase = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? location.origin
    : 'https://api.ashercarlow.com';
  var form = document.getElementById('f');
  var status = document.getElementById('status');
  var submit = document.getElementById('submit');
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    submit.disabled = true;
    status.className = '';
    status.textContent = 'Signing in…';
    var token = new FormData(form).get('token');
    try {
      var res = await fetch(apiBase + '/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token }),
      });
      if (res.ok) {
        status.className = 'ok';
        var next = new URLSearchParams(location.search).get('next');
        if (next && /^\\//.test(next)) {
          status.textContent = 'Signed in. Redirecting…';
          location.href = next;
        } else {
          status.textContent = 'Signed in.';
        }
      } else {
        var body = await res.json().catch(function () { return {}; });
        status.className = 'err';
        status.textContent = body.message || ('Login failed (' + res.status + ')');
        submit.disabled = false;
      }
    } catch (err) {
      status.className = 'err';
      status.textContent = err && err.message ? err.message : 'Network error';
      submit.disabled = false;
    }
  });
})();
</script>
</body>
</html>
`;
