export function isSignedS3ObjectUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash
      && /(?:^|\.)s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com$/.test(url.hostname)
      && /^[a-f0-9]{64}$/.test(url.searchParams.get('X-Amz-Signature') ?? '');
  } catch {
    return false;
  }
}
