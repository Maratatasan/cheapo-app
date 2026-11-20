import { createServer } from 'node:http';
import { Readable } from 'node:stream';

export function localHttpServer(handle: (request: Request) => Promise<Response>) {
  return createServer({ requestTimeout: 10_000 }, async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        for (const entry of typeof value === 'string' ? [value] : value ?? []) {
          headers.append(name, entry);
        }
      }
      const deletingWithBody = incoming.method === 'DELETE' &&
        (Number(headers.get('Content-Length')) > 0 || headers.has('Transfer-Encoding'));
      const streamsBody = incoming.method === 'POST' || incoming.method === 'PUT' || incoming.method === 'PATCH' || deletingWithBody;
      const init = {
        method: incoming.method,
        headers,
        body: streamsBody ? Readable.toWeb(incoming) : undefined,
        duplex: 'half' as const,
      };
      const response = await handle(new Request(`http://localhost${incoming.url ?? '/'}`, init));
      const body = Buffer.from(await response.arrayBuffer());
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)).end(body);
    } catch {
      outgoing.writeHead(400, { 'Cache-Control': 'no-store' }).end();
    } finally {
      incoming.resume();
    }
  });
}
