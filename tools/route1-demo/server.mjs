import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { beginAuth, opaque, equal, guard, validateIdToken, imageRequest, TOKEN, RESOURCE } from './core.mjs';
import { appendResponseDebug } from './response-debug.mjs';
import { guardMobile, completeMobileResponse } from './mobile-draft.mjs';
import { prepareKeychain } from './keychain-store.mjs';
import { createSavedSession } from './saved-session.mjs';
import { sessionRemote } from './session-remote.mjs';
import { pathToFileURL } from 'node:url';

const port = Number(process.env.PORT || 8766);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('PORT must be 1024–65535');
const stateDirectory = process.env.CHEAPO_STATE_DIRECTORY ? pathToFileURL(`${process.env.CHEAPO_STATE_DIRECTORY.replace(/\/$/,'')}/`) : new URL('./.state/', import.meta.url);
const savedAuthEnabled = process.env.SAVE_LOGIN === '1';
const keychain = savedAuthEnabled ? await prepareKeychain(stateDirectory) : undefined;
let savedManager;
const testImagePath = '/Users/maratatasan/Documents/ChatGPT/Cheapo/local-data/price-photos/Prices/PXL_20250817_155127355.jpg';
await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
const validUuid = value => typeof value === 'string' && /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
let hostId;
    try { hostId = await readFile(new URL('host-id', stateDirectory), 'utf8'); }
catch { hostId = `urn:uuid:${randomUUID()}`; await writeFile(new URL('host-id', stateDirectory), hostId, { mode: 0o600, flag: 'wx' }); }
if (!validUuid(hostId)) throw Error('The local host identifier is invalid; remove tools/route1-demo/.state/host-id and restart');
let registeredClientId;
let registeredSubject;
try {
  const saved = JSON.parse(await readFile(new URL('registration.json', stateDirectory), 'utf8'));
  if (typeof saved.clientId === 'string' && saved.clientId && saved.clientId !== 'dynamic_agent_client' && saved.clientId.length <= 512) registeredClientId = saved.clientId;
  if (typeof saved.subject === 'string' && saved.subject) registeredSubject = saved.subject;
} catch (error) { if (error.code !== 'ENOENT') throw Error('Local registration metadata is unreadable; remove tools/route1-demo/.state/registration.json and restart'); }
const origin = `http://127.0.0.1:${port}`;
const sessionId = opaque(), csrf = opaque();
let flow, session, models = [], busy = false, lastDiagnostic;
const mobileEnabled = process.env.MOBILE_TEST === '1';
let pairing = { key: opaque(), expires: Date.now() + 30 * 60_000 };
const html = (await readFile(new URL('./index.html', import.meta.url), 'utf8')).replace('__CSRF__', csrf).replace('Tokens stay in this process’s memory. Restart or expiry requires sign-in again.', savedAuthEnabled ? 'Saved sign-in uses this Mac’s Keychain. Access renews when needed; revoked or expired renewable sessions require sign-in again.' : 'Tokens stay in this process’s memory. Restart or expiry requires sign-in again.').replace('Forget local session', savedAuthEnabled ? 'Sign out of ChatGPT' : 'Forget local session');
function reply(res, status, data, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'" });
  res.end(type === 'application/json' ? JSON.stringify(data) : data);
}
async function json(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 8_100_000) throw Error('Request too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function remote(url, options = {}) {
  return fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(120_000) });
}
let savedSetup;
async function setupSavedSession() {
  if (!keychain || savedManager || !registeredClientId || !registeredSubject) return;
  if(!savedSetup) savedSetup=(async()=>{
    const account = `${hostId}/${registeredClientId}/${registeredSubject}`;
    await keychain.lock(account);
    const network = sessionRemote({remote,validateIdentity:async(token,record)=>{
      let keys;
      try {keys=await remote('https://auth.openai.com/.well-known/jwks.json');}
      catch {throw Object.assign(Error('Identity verification unavailable'),{temporary:true});}
      if(!keys.ok)throw Object.assign(Error('Identity verification unavailable'),{temporary:true});
      const identity=validateIdToken(token,await keys.json(),{issuer:'https://auth.openai.com',audience:record.clientId,nonce:record.nonce,allowMissingNonce:true});
      if(identity.sub!==record.subject)throw Error('Identity mismatch');
    }});
    savedManager = createSavedSession({registration:{clientId:registeredClientId,subject:registeredSubject},store:keychain.forAccount(account),...network});
  })().catch(error=>{savedSetup=undefined;throw error;});
  await savedSetup;
}
async function requireSession() {
  await setupSavedSession();
  if(savedManager) {
    const saved=await savedManager.current();
    session={...saved,scopes:new Set(saved.scopes)};
  }
  if (!session || session.expires <= Date.now()) { session = undefined; models = []; throw Error('Sign in again to continue'); }
  if (!session.accessToken || !session.scopes.has('resource.invoke') || !session.scopes.has('chatgpt.tokens.use.direct')) throw Error('ChatGPT plan usage was not authorized for this session');
}
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/mobile/draft' && mobileEnabled) {
      guardMobile(req, port, pairing);
      await requireSession();
      if (busy) throw Error('A draft is already running');
      busy = true;
      try {
        const model = ['gpt-5.6-luna', 'gpt-6-luna'].find(slug => models.includes(slug));
        if (!model) throw Error('Choose a listed model');
        const request = imageRequest({ ...await json(req), model }, models);
        await requireSession();
        const response = await remote(`${RESOURCE}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(request) });
        const result = await completeMobileResponse(response, new URL('response-debug.jsonl', stateDirectory));
        return reply(res, 200, { ...result, model });
      } finally { busy = false; }
    }
    guard(req, origin, csrf);
    const url = new URL(req.url, origin);
    if (req.method === 'GET' && url.pathname === '/') {
      res.setHeader('Set-Cookie', `cheapo_demo=${sessionId}; HttpOnly; SameSite=Lax; Path=/`);
      return reply(res, 200, html, 'text/html');
    }
    if (req.method === 'GET' && url.pathname === '/app.js') return reply(res, 200, await readFile(new URL('./app.js', import.meta.url), 'utf8'), 'text/javascript');
    const cookie = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('cheapo_demo='))?.slice('cheapo_demo='.length);
    if (!equal(cookie, sessionId)) return reply(res, 403, { error: 'Open the demo home page first' });
    if (req.method === 'GET' && url.pathname === '/mobile-pairing' && mobileEnabled) {
      await requireSession();
      pairing = { key: opaque(), expires: Date.now() + 30 * 60_000 };
      return reply(res, 200, { key: pairing.key, expires: pairing.expires });
    }
    if (req.method === 'GET' && url.pathname === '/test-image') {
      let file;
      try { file = await readFile(testImagePath); }
      catch (error) { if (error.code === 'ENOENT') return reply(res, 404, { error: 'Default test photo unavailable. Choose an image file.' }); throw error; }
      if (file.length > 5_900_000) return reply(res, 413, { error: 'The local test image is too large' });
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': file.length, 'Content-Disposition': 'inline; filename="PXL_20250817_155127355.jpg"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" });
      return res.end(file);
    }
    if (req.method === 'GET' && url.pathname === '/auth/callback') {
      const current = flow; flow = undefined;
      if (!current || Date.now() - current.created > 600_000 || !equal(url.searchParams.get('state'), current.state)) throw Error('Invalid or expired sign-in state');
      const code = url.searchParams.get('code'), callbackClientId = url.searchParams.get('client_id');
      if (url.searchParams.has('error') || !code) throw Error('Sign-in did not return an authorization code');
      if (registeredClientId) {
        if (callbackClientId && callbackClientId !== registeredClientId) throw Error('Sign-in returned a different client ID');
      } else if (!callbackClientId || callbackClientId === 'dynamic_agent_client' || callbackClientId.length > 512) {
        throw Error('Sign-in did not return an issued client ID');
      } else {
        registeredClientId = callbackClientId;
        await writeFile(new URL('registration.json', stateDirectory), JSON.stringify({ clientId: registeredClientId }), { mode: 0o600 });
      }
      const clientId = registeredClientId;
      const tokenResponse = await remote(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: current.redirect, code_verifier: current.verifier, resource: RESOURCE }) });
      if (!tokenResponse.ok) throw Error('Sign-in exchange failed');
      const tokens = await tokenResponse.json();
      const keys = await remote('https://auth.openai.com/.well-known/jwks.json');
      if (!keys.ok) throw Error('Identity verification unavailable');
      const identity = validateIdToken(tokens.id_token, await keys.json(), { issuer: 'https://auth.openai.com', audience: clientId, nonce: current.nonce });
      if (registeredSubject && registeredSubject !== identity.sub) throw Error('Sign-in selected a different ChatGPT account');
      registeredSubject = identity.sub;
      await writeFile(new URL('registration.json', stateDirectory), JSON.stringify({ clientId, subject: registeredSubject }), { mode: 0o600 });
      const scopes = new Set(typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/).filter(Boolean) : []);
      const accessToken = typeof tokens.access_token === 'string' && tokens.access_token ? tokens.access_token : undefined;
      const tokenExpiry = Number.isFinite(tokens.expires_in) && tokens.expires_in > 0 ? Date.now() + tokens.expires_in * 1000 : identity.exp * 1000;
      session = { accessToken, clientId, scopes, expires: Math.min(tokenExpiry, identity.exp * 1000) };
      if(savedAuthEnabled) {
        if(typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) throw Error('Renewable sign-in was not granted. Sign in again.');
        await setupSavedSession();
        await savedManager.save({accessToken,refreshToken:tokens.refresh_token,clientId,subject:identity.sub,nonce:current.nonce,scopes:[...scopes],expires:tokenExpiry});
      }
      models = [];
      res.writeHead(303, { Location: '/', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/status') {
      let sessionIssue;
      if(savedAuthEnabled)try {await requireSession();} catch(error) {sessionIssue=error.message;}
      const savedStatus=savedManager?await savedManager.status():{};
      return reply(res, 200, {signedIn:Boolean(session && session.expires>Date.now())||Boolean(savedStatus.signedIn),inferenceAllowed:Boolean(session?.accessToken && session.expires>Date.now() && session.scopes.has('resource.invoke') && session.scopes.has('chatgpt.tokens.use.direct')),savedLogin:Boolean(savedStatus.saved),sessionIssue,lastDiagnostic});
    }
    if (req.method === 'POST' && url.pathname === '/auth/start') {
      await json(req);
      const started = beginAuth({ port, hostId, clientId: registeredClientId }); flow = started.flow;
      return reply(res, 200, { url: started.url });
    }
    if (req.method === 'POST' && url.pathname === '/logout') { await json(req); session = undefined; flow = undefined; models = []; const result=savedManager?await savedManager.logout():{revocationConfirmed:false}; return reply(res, 200, { ok: true,...result }); }
    if (req.method === 'POST' && url.pathname === '/models') {
      await json(req); await requireSession();
      const response = await remote(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
      if (!response.ok) throw Error('Model catalog unavailable for this account');
      const catalog = await response.json();
      const listed = (catalog.models ?? []).filter(m => m.visibility === 'list' && typeof m.slug === 'string').map(m => ({ slug: m.slug, displayName: typeof m.display_name === 'string' ? m.display_name : m.slug }));
      models = listed.map(m => m.slug);
      return reply(res, 200, { models: listed });
    }
    if (req.method === 'POST' && url.pathname === '/draft') {
      await requireSession(); if (busy) throw Error('A draft is already running');
      busy = true;
      try {
        const request = imageRequest(await json(req), models);
        await requireSession();
        const response = await remote(`${RESOURCE}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(request) });
        const providerResponse = await appendResponseDebug(new URL('response-debug.jsonl', stateDirectory), response);
        return reply(res, 200, { providerResponse });
      } finally { busy = false; }
    }
    return reply(res, 404, { error: 'Not found' });
  } catch (error) {
    // Never forward provider bodies, callback URLs, tokens, or exception dumps.
    if (error.diagnostics) lastDiagnostic = error.diagnostics;
    const safe = new Set(['Renewable sign-in was not granted. Sign in again.', 'Renewed credentials could not be saved to Keychain. Unlock it and retry.', 'Saved sign-in is temporarily unavailable. Retry later.', 'Saved client registration was rejected. Check the companion configuration.', 'Renewal returned invalid credentials. Sign in again.', 'Mobile pairing rejected. Check the code on the Mac companion.', 'The provider response was interrupted or exceeded the local limit', 'The model did not complete a draft', 'Stream ended without response.completed', 'Sign in again to continue', 'ChatGPT plan usage was not authorized for this session', 'Choose a listed model', 'Image is too large', 'Use PNG, JPEG, or WebP', 'Image contents do not match image type', 'Request too large', 'A draft is already running', 'Model catalog unavailable for this account', 'The provider returned a non-stream response; no draft was accepted.', 'The model did not complete a draft', 'Stream ended without response.completed', 'Default test photo unavailable. Choose an image file.']);
    reply(res, 400, { error: error.diagnostics ? error.message : safe.has(error.message) ? error.message : 'Request failed. Return home and retry or sign in again.', ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}), ...(typeof error.debugLogSaved === 'boolean' ? { debugLogSaved: error.debugLogSaved } : {}) });
  }
});
server.requestTimeout = 130_000;
server.headersTimeout = 10_000;
server.listen(port, '127.0.0.1', () => console.log(`Local demo: ${origin} (sign-in and draft require explicit clicks)`));
