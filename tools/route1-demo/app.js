/* Independently written browser controller; no dependencies. */
const el = id => document.getElementById(id);
const csrf = document.querySelector('meta[name="csrf"]').content;
const show = message => { el('status').textContent = message; };
const imageInfo = document.createElement('small');
imageInfo.id = 'image-info';
el('image').insertAdjacentElement('afterend', imageInfo);
el('image').required = false;
const modelInfo = document.createElement('small');
modelInfo.id = 'model-info';
el('model').insertAdjacentElement('afterend', modelInfo);
const debugInfo = document.createElement('small');
debugInfo.textContent = 'Each explicit draft attempt appends the provider response (up to 1 MB) to tools/route1-demo/.state/response-debug.jsonl. Your photo and request credentials are not logged.';
el('result').insertAdjacentElement('beforebegin', debugInfo);
function diagnosticText(d) {
  if (!d) return '';
  const fields = [Number.isInteger(d.status) ? `HTTP ${d.status}` : '', d.contentType ? `type ${d.contentType}` : '', d.responseStatus ? `response ${d.responseStatus}` : '', d.code ? `code ${d.code}` : '', d.param ? `field ${d.param}` : '', d.requestId ? `request ${d.requestId}` : '', typeof d.redirected === 'boolean' ? `redirected ${d.redirected}` : '', d.finalOrigin ? `origin ${d.finalOrigin}` : ''].filter(Boolean).join(' · ');
  if (d.kind === 'responses_object' && d.responseStatus === 'completed') return `The provider returned a completed JSON response instead of the documented event stream. The demo failed closed and did not accept its output.${fields ? ` (${fields})` : ''}`;
  if (d.kind === 'html') return `The provider returned an HTML page instead of an event stream.${fields ? ` (${fields})` : ''}`;
  if (d.kind === 'empty') return `The provider returned an empty body instead of an event stream.${fields ? ` (${fields})` : ''}`;
  if (d.kind === 'event_stream_body') return `The body contained event-stream framing, but the HTTP Content-Type was missing or not text/event-stream. The demo did not accept it.${d.eventTypes?.length ? ` Events: ${d.eventTypes.join(', ')}.` : ''}${fields ? ` (${fields})` : ''}`;
  if (d.kind === 'stream_empty') return `The provider opened an event-stream response but sent zero event bytes.${fields ? ` (${fields})` : ''}`;
  if (d.kind === 'stream_ended') return `The event stream ended without a response.completed event.${fields ? ` (${fields})` : ''}`;
  if (d.kind === 'unclassified_body') return `The provider returned a non-JSON body that was not an event stream. Its contents are intentionally hidden.${fields ? ` (${fields})` : ''}`;
  if (d.kind === 'invalid_json') return `The provider labeled its response as JSON, but the bounded body was not valid JSON.${fields ? ` (${fields})` : ''}`;
  if (d.kind === 'body_too_large') return `The provider response exceeded the local diagnostic size limit and was not inspected.${fields ? ` (${fields})` : ''}`;
  if (d.code === 'subscription_sharing_unsupported_capability') return `The plan route rejected a model or request capability. Do not retry unchanged.${fields ? ` (${fields})` : ''}`;
  if (d.code === 'subscription_sharing_user_not_eligible') return `This account, workspace, or policy is not eligible for ChatGPT plan usage. Do not retry the same request.${fields ? ` (${fields})` : ''}`;
  if (d.code === 'subscription_sharing_usage_limit_exceeded') return `A ChatGPT plan usage limit was reached. Check ChatGPT settings → Usage before trying again.${fields ? ` (${fields})` : ''}`;
  if (d.code === 'subscription_sharing_usage_unavailable') return `ChatGPT plan usage is temporarily unavailable. Wait before trying again.${fields ? ` (${fields})` : ''}`;
  if (d.kind?.startsWith('response.')) return `The response stream ended without an accepted completed draft.${fields ? ` (${fields})` : ''}`;
  return `Provider response could not be accepted as a streamed draft.${fields ? ` (${fields})` : ''}`;
}
let image, inferenceAllowed = false, catalogLoading;
function updateSubmit() { el('submit').disabled = !inferenceAllowed || !image || !el('model').value; }
async function post(path, data = {}) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(data) });
  const value = await response.json();
  if (!response.ok) {
    const error = Error(value.error || 'Request failed');
    error.diagnostics = value.diagnostics;
    error.debugLogSaved = value.debugLogSaved;
    throw error;
  }
  return value;
}
async function refresh() {
  const status = await (await fetch('/status')).json();
  inferenceAllowed = Boolean(status.inferenceAllowed);
  el('models').disabled = !inferenceAllowed;
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
  if (inferenceAllowed) await loadCatalog(true);
  else updateSubmit();
  if (status.lastDiagnostic) show(`${el('status').textContent} Last request: ${diagnosticText(status.lastDiagnostic)}`);
}
el('signin').onclick = async () => { try { const result = await post('/auth/start'); location.assign(result.url); } catch (error) { show(error.message); } };
el('logout').onclick = async () => { try { await post('/logout'); el('model').replaceChildren(new Option('Load catalog first', '')); el('result').textContent = 'Local session forgotten.'; await refresh(); } catch (error) { show(error.message); } };
el('models').onclick = () => loadCatalog(false);
async function loadCatalog(automatic) {
  if (catalogLoading) return catalogLoading;
  catalogLoading = (async () => {
    el('model').disabled = true;
    el('model').replaceChildren(new Option('Loading account models…', ''));
    modelInfo.textContent = '';
    if (!automatic) show('Loading your account’s model catalog…');
    try {
      const result = await post('/models');
      const selected = result.models.find(model => model.slug === 'gpt-5.6-luna') || result.models.find(model => model.slug === 'gpt-6-luna');
      if (!selected) {
        el('model').replaceChildren(new Option('Luna model unavailable', ''));
        modelInfo.textContent = 'Your account catalog does not list gpt-5.6-luna or gpt-6-luna. No other model will be selected.';
        show(modelInfo.textContent);
        return;
      }
      el('model').replaceChildren(new Option(selected.displayName, selected.slug));
      el('model').value = selected.slug;
      modelInfo.textContent = `Selected from your account catalog: ${selected.displayName} (${selected.slug}).`;
      show(`Selected listed model ${selected.slug}. The photo has not been sent.`);
    } catch (error) {
      el('model').replaceChildren(new Option('Could not load model catalog', ''));
      modelInfo.textContent = error.message;
      show(error.message);
    } finally {
      el('model').disabled = true;
      catalogLoading = undefined;
      updateSubmit();
    }
  })();
  return catalogLoading;
}
el('image').onchange = async () => {
  const file = el('image').files[0]; if (!file) return;
  await useImageFile(file, file.name);
};
async function useImageFile(file, name) {
  image = undefined; el('preview').hidden = true;
  updateSubmit();
  if (file.size > 5_900_000 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { imageInfo.textContent = 'Choose a PNG, JPEG, or WebP smaller than 5.9 MB.'; show(imageInfo.textContent); return; }
  const reader = new FileReader();
  reader.onload = () => { image = reader.result; el('preview').src = image; el('preview').hidden = false; imageInfo.textContent = `Selected: ${name}. It stays local until you press “Send image and draft price”.`; updateSubmit(); };
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
  event.preventDefault(); if (!el('model').value) { show('No listed Luna model is available in this account catalog.'); return; } if (!image) { show('Choose a supported test image first.'); return; }
  el('submit').disabled = true; el('result').textContent = 'Waiting for the raw provider response…';
  try {
    const result = await post('/draft', { model: el('model').value, image });
    const raw = result.providerResponse;
    const contentType = Object.entries(raw.headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1] || '(missing)';
    const truncation = raw.bodyTruncated ? `\n[Body truncated at ${raw.bytesCaptured} bytes; ${raw.bytesObserved} bytes observed.]` : '';
    el('result').textContent = `HTTP ${raw.status ?? '(no status)'}\nContent-Type: ${contentType}\nSafe response headers: ${JSON.stringify(raw.headers, null, 2)}\nRaw body${raw.bodyReadError ? ' (read interrupted)' : ''}:\n${raw.bodyText || '(empty)'}${truncation}`;
    show(`Raw provider response captured; it has not been interpreted as a draft.${raw.debugLogSaved ? ' Appended to the local response log.' : ' The local response log could not be written.'}`);
  }
  catch (error) {
    el('result').textContent = 'No provider response was captured.';
    const d = error.diagnostics;
    const logNote = error.debugLogSaved === true ? ' Raw response saved locally.' : error.debugLogSaved === false ? ' The local raw response log could not be written.' : '';
    if (!d) show(`${error.message}${logNote}`);
    else show(`${diagnosticText(d)}${logNote}`);
  }
  finally { updateSubmit(); }
};
refresh().catch(() => show('Cannot read local session.'));
preloadTestImage();

el('pair-mobile').onclick = async () => {
  try {
    const response = await fetch('/mobile-pairing');
    const value = await response.json();
    if (!response.ok) throw Error(value.error || 'Mobile test mode is not enabled.');
    el('pairing').textContent = `Emulator pairing code (expires in 30 minutes): ${value.key}`;
  } catch (error) { el('pairing').textContent = error.message; }
};
