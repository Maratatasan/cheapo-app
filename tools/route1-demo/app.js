/* Independently written browser controller; no dependencies. */
const el = id => document.getElementById(id);
const csrf = document.querySelector('meta[name="csrf"]').content;
const show = message => { el('status').textContent = message; };
let image;
async function post(path, data = {}) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(data) });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || 'Request failed');
  return value;
}
async function refresh() {
  const status = await (await fetch('/status')).json();
  el('models').disabled = !status.inferenceAllowed;
  el('submit').disabled = !status.inferenceAllowed;
  show(status.signedIn ? (status.inferenceAllowed ? 'ChatGPT identity verified and plan usage authorized. Load the model catalog to continue.' : 'ChatGPT identity verified, but plan usage was not authorized for this session.') : 'Signed out.');
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
  catch (error) { el('result').textContent = 'No completed draft available.'; show(error.message); }
  finally { el('submit').disabled = false; }
};
refresh().catch(() => show('Cannot read local session.'));
