import { createServer } from 'node:http';

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const port = Number(url.searchParams.get('port'));
  const state = url.searchParams.get('state');
  if (url.pathname !== '/' || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !/^[a-f0-9-]{36}$/i.test(state ?? '')) {
    response.writeHead(404).end();
    return;
  }

  const callback = new URL(`http://127.0.0.1:${port}/auth/callback`);
  callback.search = new URLSearchParams({ code: 'mock-code', state }).toString();
  const invalidCallback = new URL(callback);
  invalidCallback.searchParams.set('state', 'wrong-state');
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(`<!doctype html><meta name="viewport" content="width=device-width">
    <title>Mock callback</title><h1>Mock authorization</h1>
    <p>No account or provider is involved.</p>
    <p><a href="${callback.href.replaceAll('&', '&amp;')}">Send callback now</a></p>
    <p><a href="${invalidCallback.href.replaceAll('&', '&amp;')}">Send invalid callback</a></p>
    <p>For a delayed callback, wait on this screen before tapping.</p>`);
});

server.listen(Number(process.argv[2] ?? '18765'), '127.0.0.1', () => {
  console.log(`Mock page ready on port ${server.address().port}`);
});
