import { fetch } from 'expo/fetch';
import { requestPhotoDraft } from '@/lib/direct-auth/photo-analysis';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

const provider = jest.mocked(fetch);
const image = 'data:image/jpeg;base64,/9j/';
const draft = { product: 'Café beans', productType: 'Coffee beans', variety: null, brand: 'Café', price: 2.5, currency: 'GBP', unit_price: { amount: 5, unit: 'kg' }, uncertainty: '' };

function bodyResponse(chunks: Uint8Array[], status = 200) {
  const reader = {
    read: jest.fn(async () => chunks.length ? { done: false, value: chunks.shift() } : { done: true }),
    cancel: jest.fn(async () => {}),
    releaseLock: jest.fn(),
  };
  const response = { ok: status >= 200 && status < 300, status, body: { getReader: () => reader, cancel: reader.cancel } };
  provider.mockResolvedValueOnce(response as unknown as Awaited<ReturnType<typeof fetch>>);
  return reader;
}

function event(type: string, response?: unknown) {
  return `event: ${type}\r\ndata: ${JSON.stringify({ type, response })}\r\n\r\n`;
}

function completed(parts: unknown[]) {
  return event('response.completed', { status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: parts }] });
}

function catalog(models = [{ slug: 'gpt-5.6-luna', visibility: 'list' }]) {
  bodyResponse([new TextEncoder().encode(JSON.stringify({ models }))]);
}

function analyze(signal = new AbortController().signal) {
  return requestPhotoDraft({ accessToken: 'test-token', image, signal });
}

beforeEach(() => provider.mockReset());

test('uses the preferred listed model and returns only the completed structured image draft', async () => {
  catalog([{ slug: 'gpt-6-luna', visibility: 'list' }, { slug: 'gpt-5.6-luna', visibility: 'list' }]);
  const chunks = new TextEncoder().encode(event('response.output_text.delta') + completed([{ type: 'output_text', text: JSON.stringify(draft) }]));
  const reader = bodyResponse(Array.from(chunks, byte => Uint8Array.of(byte)));
  const { signal } = new AbortController();

  await expect(analyze(signal)).resolves.toEqual(draft);
  expect(provider).toHaveBeenCalledTimes(2);
  expect(provider).toHaveBeenNthCalledWith(1, 'https://api.openai.com/v1/models', {
    headers: { Authorization: 'Bearer test-token' }, redirect: 'error', signal,
  });
  const [url, request] = provider.mock.calls[1];
  expect(url).toBe('https://api.openai.com/v1/responses');
  expect(request).toMatchObject({ method: 'POST', redirect: 'error', signal, headers: { Authorization: 'Bearer test-token' } });
  expect(JSON.parse(String(request?.body))).toMatchObject({
    model: 'gpt-5.6-luna', store: false, stream: true,
    input: [{ role: 'user', content: [expect.anything(), { type: 'input_image', image_url: image }] }],
    text: { format: { type: 'json_schema', strict: true, schema: { required: expect.arrayContaining(['productType', 'variety', 'brand']) } } },
  });
  expect(reader.releaseLock).toHaveBeenCalled();
});

test('uses the listed fallback when the preferred model is hidden', async () => {
  catalog([{ slug: 'gpt-5.6-luna', visibility: 'hidden' }, { slug: 'gpt-6-luna', visibility: 'list' }]);
  bodyResponse([new TextEncoder().encode(completed([{ type: 'output_text', text: JSON.stringify(draft) }]))]);
  await expect(analyze()).resolves.toEqual(draft);
  expect(JSON.parse(String(provider.mock.calls[1][1]?.body))).toMatchObject({ model: 'gpt-6-luna' });
});

test('withholds the photo when the catalog has no supported listed model', async () => {
  catalog([{ slug: 'other', visibility: 'list' }]);
  await expect(analyze()).rejects.toThrow('No supported photo model');
  expect(provider).toHaveBeenCalledTimes(1);
});

test.each([
  [event('response.output_text.delta'), 'ended before'],
  [event('response.incomplete'), 'did not complete'],
  [event('response.failed', { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'private detail' } }), 'usage limit'],
  [completed([{ type: 'refusal', refusal: 'private detail' }]), 'could not analyse this photo'],
  [completed([{ type: 'output_text', text: '{malformed draft}' }]), 'invalid price draft'],
  [completed([{ type: 'output_text', text: JSON.stringify({ ...draft, price: -1 }) }]), 'invalid price draft'],
  [completed([{ type: 'output_text', text: JSON.stringify({ ...draft, variety: 42 }) }]), 'invalid price draft'],
])('rejects unusable stream output without sending a retry', async (stream, message) => {
  catalog();
  bodyResponse([new TextEncoder().encode(stream)]);
  await expect(analyze()).rejects.toThrow(message);
  expect(provider).toHaveBeenCalledTimes(2);
});

test('keeps credential-bearing transport details out of the surfaced error', async () => {
  catalog();
  provider.mockRejectedValueOnce(new Error('Network failure with test-token and private request contents'));
  await expect(analyze()).rejects.toThrow(/^Could not read the ChatGPT response\. Check your connection and try again\.$/);
  expect(provider).toHaveBeenCalledTimes(2);
});

test('stops reading an oversized stream', async () => {
  catalog();
  const reader = bodyResponse([new Uint8Array(2_000_001)]);
  await expect(analyze()).rejects.toThrow('too large');
  expect(reader.cancel).toHaveBeenCalled();
  expect(reader.releaseLock).toHaveBeenCalled();
});

test('does not send a photo if analysis is cancelled while loading the catalog', async () => {
  const controller = new AbortController();
  catalog();
  const analysis = analyze(controller.signal);
  controller.abort();
  await expect(analysis).rejects.toThrow('was cancelled');
  expect(provider).toHaveBeenCalledTimes(1);
});
