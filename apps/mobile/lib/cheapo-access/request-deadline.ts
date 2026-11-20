export function requestInterrupted() {
  return new Error('Cheapo request interrupted.');
}

export async function withCheapoDeadline<T>(
  signal: AbortSignal | undefined, timeoutMs: number, work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const stopped = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(requestInterrupted()), { once: true });
  });
  const timer = setTimeout(cancel, timeoutMs);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    return await Promise.race([stopped, Promise.resolve().then(() => {
      if (controller.signal.aborted) throw requestInterrupted();
      return work(controller.signal);
    })]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
