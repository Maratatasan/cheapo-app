import { json } from './api-http.ts';

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

function gatewayRequest(event: GatewayEvent): Request {
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
  const body = method === 'GET' || method === 'HEAD' || event.body === undefined
    ? undefined
    : event.isBase64Encoded ? new Uint8Array(Buffer.from(event.body, 'base64')) : event.body;
  return new Request(url, { method, headers, body });
}

export function createGatewayHandler(handle: (request: Request) => Promise<Response>) {
  return async (event: GatewayEvent) => {
    let request: Request;
    try {
      request = gatewayRequest(event);
    } catch {
      return gatewayResponse(json({ error: 'invalid_request' }, 400));
    }
    try {
      return await gatewayResponse(await handle(request));
    } catch {
      return gatewayResponse(json({ error: 'service_unavailable' }, 500));
    }
  };
}
