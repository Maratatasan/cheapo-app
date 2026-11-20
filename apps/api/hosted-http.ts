import { json } from './api-http.ts';

const maxMetadataBytes = 256 * 1024;

type GatewayEvent = {
  version: string;
  rawPath: string;
  rawQueryString: string;
  requestContext: { http: { method: string } };
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
};

async function gatewayResponse(response: Response) {
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
    isBase64Encoded: false,
  };
}

function gatewayRequest(event: GatewayEvent): Request | Response {
  if (event.version !== '2.0' || !event.rawPath.startsWith('/v1/')
      || event.rawPath.includes('?') || event.rawPath.includes('#')) {
    throw new Error('Invalid API Gateway request.');
  }
  // A trusted synthetic origin keeps client-provided Host out of route parsing.
  const url = new URL('https://cheapo.invalid' + event.rawPath);
  if (!url.pathname.startsWith('/v1/')) throw new Error('Invalid API Gateway path.');
  url.search = event.rawQueryString;
  const method = event.requestContext.http.method;
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers.set(key, value);
  }
  let body: string | Uint8Array<ArrayBuffer> | undefined;
  if (method !== 'GET' && method !== 'HEAD' && event.body !== undefined) {
    const { body: encoded, isBase64Encoded } = event;
    const maxEncodedBytes = isBase64Encoded ? Math.ceil(maxMetadataBytes / 3) * 4 : maxMetadataBytes;
    if (Buffer.byteLength(encoded) > maxEncodedBytes) return json({ error: 'body_too_large' }, 413);
    body = isBase64Encoded ? new Uint8Array(Buffer.from(encoded, 'base64')) : encoded;
    if (body instanceof Uint8Array && body.byteLength > maxMetadataBytes) return json({ error: 'body_too_large' }, 413);
  }
  return new Request(url, { method, headers, body });
}

export function createGatewayHandler(handle: (request: Request) => Promise<Response>) {
  return async (event: GatewayEvent) => {
    let request: Request | Response;
    try {
      request = gatewayRequest(event);
    } catch {
      return gatewayResponse(json({ error: 'invalid_request' }, 400));
    }
    if (request instanceof Response) return gatewayResponse(request);
    try {
      return await gatewayResponse(await handle(request));
    } catch {
      return gatewayResponse(json({ error: 'service_unavailable' }, 500));
    }
  };
}
