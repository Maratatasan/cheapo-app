import { open } from 'node:fs/promises';

const MAX_BODY_BYTES = 1_000_000;
const SECRET_HEADER = /authorization|cookie|token|secret|api[-_]?key|credential/i;

function safeHeaders(headers) {
  const output = {};
  headers?.forEach((value, name) => {
    if (!SECRET_HEADER.test(name)) output[name] = value;
  });
  return output;
}

export async function appendResponseDebug(path, response, timestamp = new Date().toISOString()) {
  const captured = []; let bytesCaptured = 0, bytesObserved = 0, truncated = false;
  let readError = false;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesObserved += value.byteLength;
        if (bytesCaptured < MAX_BODY_BYTES) {
          const keep = value.subarray(0, Math.min(value.byteLength, MAX_BODY_BYTES - bytesCaptured));
          captured.push(Buffer.from(keep));
          bytesCaptured += keep.byteLength;
        }
        if (bytesObserved > MAX_BODY_BYTES) truncated = true;
      }
    } catch { readError = true; truncated = true; }
    finally { reader.releaseLock(); }
  }
  const record = {
    timestamp,
    status: Number.isInteger(response.status) ? response.status : null,
    headers: safeHeaders(response.headers),
    bodyText: Buffer.concat(captured).toString('utf8'),
    bytesCaptured,
    bytesObserved,
    bodyTruncated: truncated,
    bodyReadError: readError
  };
  let debugLogSaved = true;
  let handle;
  try {
    handle = await open(path, 'a', 0o600);
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
  } catch { debugLogSaved = false; }
  finally { await handle?.close().catch(() => {}); }
  return { ...record, debugLogSaved };
}
