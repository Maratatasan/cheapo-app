import { equal, readCompleted, safeProviderFailure } from './core.mjs';
import { appendResponseDebug } from './response-debug.mjs';

export function guardMobile(req, port, pairing) {
  if (req.method !== 'POST' || ![`127.0.0.1:${port}`, `10.0.2.2:${port}`].includes(req.headers.host) || req.headers.origin || req.headers['content-type'] !== 'application/json' || !pairing || pairing.expires <= Date.now() || !equal(req.headers['x-cheapo-pairing'], pairing.key)) throw Error('Mobile pairing rejected. Check the code on the Mac companion.');
}
export async function completeMobileResponse(response, logPath) {
  const raw = await appendResponseDebug(logPath, response);
  const meta = { status: raw.status, requestId: raw.headers['x-request-id'] || raw.headers['openai-request-id'], contentType: raw.headers['content-type'] };
  if (!response.ok) {
    let payload; try { payload = JSON.parse(raw.bodyText); } catch { /* Raw error remains local. */ }
    const error = Error('OpenAI declined the draft request');
    error.diagnostics = safeProviderFailure(meta.status,meta.requestId,payload,meta.contentType);
    throw error;
  }
  if (raw.bodyTruncated || raw.bodyReadError) throw Error('The provider response was interrupted or exceeded the local limit');
  // Completion events, not a Content-Type header, establish a valid SSE draft.
  const draft = await readCompleted((async function* () { yield Buffer.from(raw.bodyText); })(),meta);
  return { draft, modelResponseStatus: raw.status, requestId: meta.requestId, debugLogSaved: raw.debugLogSaved };
}
