import type { CheapoAccess } from '../lib/cheapo-access/client';

type ShoppingWriteRequest = Awaited<ReturnType<CheapoAccess['openShoppingWriteSession']>>['request'];
const deadlineMs = 45_000;

export async function readShoppingWriteReply(
  request: ShoppingWriteRequest, path: string, init: RequestInit, readBody: (status: number) => boolean,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Error('Cheapo did not acknowledge this change in time.'));
    }, deadlineMs);
  });
  const attempt = async () => {
    const response = await request(path, { ...init, signal: controller.signal });
    const { status } = response;
    const body: unknown = readBody(status) ? await response.json() : undefined;
    return { status, body };
  };
  try {
    return await Promise.race([attempt(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
