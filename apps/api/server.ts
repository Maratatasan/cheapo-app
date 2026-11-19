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
      const init = {
        method: incoming.method,
        headers,
        body: incoming.method === 'PUT' ? Readable.toWeb(incoming) : undefined,
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
