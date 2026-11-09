/* Independently written browser controller; no dependencies. */
const el = id => document.getElementById(id);
const csrf = document.querySelector('meta[name="csrf"]').content;
const show = message => { el('status').textContent = message; };
let image;
async function post(path, data = {}) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(data) });
  const value = await response.json();
  if (!response.ok) {
    const error = Error(value.error || 'Request failed');
    error.diagnostics = value.diagnostics;
    throw error;
  }
  return value;
}
async function refresh() {
  const status = await (await fetch('/status')).json();
  el('models').disabled = !status.inferenceAllowed;
  el('submit').disabled = !status.inferenceAllowed;
  el('signin').hidden = Boolean(status.inferenceAllowed);
  el('logout').hidden = !status.signedIn;
  if (!status.signedIn) {
    el('signin').textContent = 'Sign in with ChatGPT';
    show('Identity: signed out · ChatGPT plan permission: not checked.');
  } else if (status.inferenceAllowed) {
    show('Identity: verified · ChatGPT plan permission: granted. No model or image request has been sent yet.');
  } else {
    el('signin').textContent = 'Retry ChatGPT sign-in';
    show('Identity: verified · ChatGPT plan permission: unavailable. Enable plan usage in ChatGPT settings, then retry sign-in. Identity alone does not authorize AI requests.');
  }
}
el('signin').onclick = async () => { try { const result = await post('/auth/start'); location.assign(result.url); } catch (error) { show(error.message); } };
el('logout').onclick = async () => { try { await post('/logout'); el('model').replaceChildren(new Option('Load catalog first', '')); el('result').textContent = 'Local session forgotten.'; await refresh(); } catch (error) { show(error.message); } };
el('models').onclick = async () => {
  try { show('Loading model catalog…'); const result = await post('/models'); el('model').replaceChildren(new Option('Choose a model', ''), ...result.models.map(model => new Option(model.displayName, model.slug))); show(result.models.length ? 'Choose a model and test image.' : 'No models with list visibility returned.'); } catch (error) { show(error.message); }
};
el('image').onchange = async () => {
  image = undefined; el('preview').hidden = true;
  const file = el('image').files[0]; if (!file) return;
  if (file.size > 5_900_000 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { show('Choose a PNG, JPEG, or WebP smaller than 5.9 MB.'); return; }
  const reader = new FileReader();
  reader.onload = () => { image = reader.result; el('preview').src = image; el('preview').hidden = false; };
  reader.readAsDataURL(file);
};
el('draft').onsubmit = async event => {
  event.preventDefault(); if (!image) { show('Choose a supported test image first.'); return; }
  el('submit').disabled = true; el('result').textContent = 'Waiting for a completed draft…';
  try { const result = await post('/draft', { model: el('model').value, image }); el('result').textContent = JSON.stringify(result.draft, null, 2); show('Draft complete. Review every field against the image before using it.'); }
  catch (error) {
    el('result').textContent = 'No completed draft available.';
    const d = error.diagnostics;
    if (!d) show(error.message);
    else {
      const known = {
        subscription_sharing_user_not_eligible: 'This account, workspace, or policy is not eligible for ChatGPT plan usage. Do not retry the same request.',
        subscription_sharing_usage_limit_exceeded: 'A ChatGPT plan usage limit was reached. Check ChatGPT settings → Usage before trying again.',
        subscription_sharing_usage_unavailable: 'ChatGPT plan usage is temporarily unavailable. Wait before trying again.',
        subscription_sharing_unsupported_capability: 'The request contains a model or feature the plan route does not support. The field below can help identify it; do not retry unchanged.',
        subscription_sharing_route_not_supported: 'This route is not enabled for this integration.',
        chatpass_v2_scope_not_authorized: 'The current authorization does not permit this operation. Sign-in permissions may need review.',
        chatpass_v2_invalid_authorization_context: 'The current authorization context does not permit this operation. Sign-in permissions may need review.'
      };
      const details = [Number.isInteger(d.status) ? `HTTP ${d.status}` : '', d.code ? `code ${d.code}` : '', d.param ? `field ${d.param}` : '', d.requestId ? `request ${d.requestId}` : ''].filter(Boolean).join(' · ');
      const reason = known[d.code] || 'The provider rejected the request before streaming. The status and safe error identifiers below can distinguish a request-format issue from account or route availability.';
      show(`${reason}${details ? ` (${details})` : ''}`);
    }
  }
  finally { el('submit').disabled = false; }
};
refresh().catch(() => show('Cannot read local session.'));
