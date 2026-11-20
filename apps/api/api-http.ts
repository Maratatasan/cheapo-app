export function json(body: object, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export function unauthorized() {
  return json({ error: 'unauthenticated' }, 401, { 'WWW-Authenticate': 'Bearer' });
}

export async function readJson(request: Request, maxBytes: number, invalid: string): Promise<{ value: unknown } | Response> {
  const mediaType = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') return json({ error: 'expected_json' }, 415);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: invalid }, 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) return json({ error: 'body_too_large' }, 413);
      chunks.push(value);
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length));
    return { value: JSON.parse(text) };
  } catch {
    return json({ error: invalid }, 400);
  } finally {
    reader.releaseLock();
  }
}
