/* Independently written browser controller; no dependencies. */
const el = id => document.getElementById(id);
const csrf = document.querySelector('meta[name="csrf"]').content;
const show = message => { el('status').textContent = message; };
const imageInfo = document.createElement('small');
imageInfo.id = 'image-info';
el('image').insertAdjacentElement('afterend', imageInfo);
el('image').required = false;
function diagnosticText(d) {
  if (!d) return '';
  const fields = [Number.isInteger(d.status) ? `HTTP ${d.status}` : '', d.contentType ? `type ${d.contentType}` : '', d.responseStatus ? `response ${d.responseStatus}` : '', d.code ? `code ${d.code}` : '', d.param ? `field ${d.param}` : '', d.requestId ? `request ${d.requestId}` : '', typeof d.redirected === 'boolean' ? `redirected ${d.redirected}` : '', d.finalOrigin ? `origin ${d.finalOrigin}` : ''].filter(Boolean).join(' · ');
  if (d.kind === 'responses_object' && d.responseStatus === 'completed') return `The provider returned a completed JSON response instead of the documented event stream. The demo failed closed and did not accept its output.${fields ? ` (${fields})` : ''}`;
  if (d.kind === 'html') return `The provider returned an HTML page instead of an event stream.${fields ? ` (${fields})` : ''}`;
  if (d.kind === 'empty') return `The provider returned an empty body instead of an event stream.${fields ? ` (${fields})` : ''}`;
  if (d.code === 'subscription_sharing_unsupported_capability') return `The plan route rejected a model or request capability. Do not retry unchanged.${fields ? ` (${fields})` : ''}`;
  if (d.code === 'subscription_sharing_user_not_eligible') return `This account, workspace, or policy is not eligible for ChatGPT plan usage. Do not retry the same request.${fields ? ` (${fields})` : ''}`;
  if (d.code === 'subscription_sharing_usage_limit_exceeded') return `A ChatGPT plan usage limit was reached. Check ChatGPT settings → Usage before trying again.${fields ? ` (${fields})` : ''}`;
  if (d.code === 'subscription_sharing_usage_unavailable') return `ChatGPT plan usage is temporarily unavailable. Wait before trying again.${fields ? ` (${fields})` : ''}`;
  if (d.kind?.startsWith('response.')) return `The response stream ended without an accepted completed draft.${fields ? ` (${fields})` : ''}`;
  return `Provider response could not be accepted as a streamed draft.${fields ? ` (${fields})` : ''}`;
}
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
  if (status.lastDiagnostic) show(`${el('status').textContent} Last request: ${diagnosticText(status.lastDiagnostic)}`);
}
el('signin').onclick = async () => { try { const result = await post('/auth/start'); location.assign(result.url); } catch (error) { show(error.message); } };
el('logout').onclick = async () => { try { await post('/logout'); el('model').replaceChildren(new Option('Load catalog first', '')); el('result').textContent = 'Local session forgotten.'; await refresh(); } catch (error) { show(error.message); } };
el('models').onclick = async () => {
  try { show('Loading model catalog…'); const result = await post('/models'); el('model').replaceChildren(new Option('Choose a model', ''), ...result.models.map(model => new Option(model.displayName, model.slug))); show(result.models.length ? 'Choose a model and test image.' : 'No models with list visibility returned.'); } catch (error) { show(error.message); }
};
el('image').onchange = async () => {
  const file = el('image').files[0]; if (!file) return;
  await useImageFile(file, file.name);
};
async function useImageFile(file, name) {
  image = undefined; el('preview').hidden = true;
  if (file.size > 5_900_000 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { imageInfo.textContent = 'Choose a PNG, JPEG, or WebP smaller than 5.9 MB.'; show(imageInfo.textContent); return; }
  const reader = new FileReader();
  reader.onload = () => { image = reader.result; el('preview').src = image; el('preview').hidden = false; imageInfo.textContent = `Selected: ${name}. It stays local until you press “Send image and draft price”.`; };
  reader.onerror = () => { imageInfo.textContent = 'Could not read this image. Choose another file.'; show(imageInfo.textContent); };
  reader.readAsDataURL(file);
}
async function preloadTestImage() {
  try {
    const response = await fetch('/test-image', { cache: 'no-store' });
    if (!response.ok) throw Error('Default test photo unavailable. Choose an image file.');
    const blob = await response.blob();
    await useImageFile(new File([blob], 'PXL_20250817_155127355.jpg', { type: 'image/jpeg' }), 'PXL_20250817_155127355.jpg');
  } catch (error) { imageInfo.textContent = error.message; }
}
el('draft').onsubmit = async event => {
  event.preventDefault(); if (!image) { show('Choose a supported test image first.'); return; }
  el('submit').disabled = true; el('result').textContent = 'Waiting for a completed draft…';
  try { const result = await post('/draft', { model: el('model').value, image }); el('result').textContent = JSON.stringify(result.draft, null, 2); show('Draft complete. Review every field against the image before using it.'); }
  catch (error) {
    el('result').textContent = 'No completed draft available.';
    const d = error.diagnostics;
    if (!d) show(error.message);
    else show(diagnosticText(d));
  }
  finally { el('submit').disabled = false; }
};
refresh().catch(() => show('Cannot read local session.'));
preloadTestImage();
