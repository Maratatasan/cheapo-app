import { parseCheapoApiOrigin } from "./origin";

const storageKey = "cheapo-api.device-credential";
const credentialFormat = /^cheapo_[A-Za-z0-9_-]{43}$/;
const checkPath = "/v1/me/comparison-preferences/__cheapo-device-enrollment__";
const checkDeadlineMs = 40_000;
const checkRetryDelayMs = 16_000;

type ProtectedStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
};
type Transport = (url: string, init: RequestInit) => Promise<Response>;
export type CheapoReadSession = {
  cacheScope: string;
  assertCurrent(): void;
  get(path: string, signal?: AbortSignal): Promise<Response>;
};
export type AccessState = "missing" | "connected" | "denied" | "unavailable";

export class CheapoAccessError extends Error {}

export function createCheapoAccess(
  originValue: string,
  storage: ProtectedStorage,
  transport: Transport,
  digestCacheScope?: (value: string) => Promise<string>,
) {
  const parsedOrigin = parseCheapoApiOrigin(originValue);
  if (!parsedOrigin) throw new Error("Invalid Cheapo API origin.");
  const origin = parsedOrigin;
  const probeUrl = new URL(checkPath, origin);
  let enrollmentRevision = 0;

  async function loadCredential(): Promise<string | null> {
    const stored = await storage.getItem(storageKey);
    if (!stored) return null;
    try {
      const value = JSON.parse(stored);
      return value?.origin === origin && typeof value.credential === "string"
        && credentialFormat.test(value.credential) ? value.credential : null;
    } catch {
      return null;
    }
  }

  function send(url: URL, credential: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${credential}`);
    return transport(url.href, { ...init, headers, redirect: "error", credentials: "omit" });
  }

  async function probe(credential: string): Promise<Exclude<AccessState, "missing">> {
    const controller = new AbortController();
    const startedAt = Date.now();
    const timeout = setTimeout(() => controller.abort(), checkDeadlineMs);
    const options = { signal: controller.signal };
    try {
      let response = await send(probeUrl, credential, options);
      // A read-only check can wait for a paused backend to resume and retry once.
      if (response.status === 503 && Date.now() - startedAt < checkDeadlineMs / 2) {
        await new Promise<void>(resolve => setTimeout(resolve, checkRetryDelayMs));
        if (!controller.signal.aborted) response = await send(probeUrl, credential, options);
      }
      if (response.status === 401 || response.status === 403) return "denied";
      if (!response.ok) return "unavailable";
      const value: unknown = await response.json();
      return value && typeof value === "object" && "basis" in value
        && (value.basis === null || typeof value.basis === "string") ? "connected" : "unavailable";
    } catch {
      return "unavailable";
    } finally {
      clearTimeout(timeout);
    }
  }

  function apiUrl(path: string): URL {
    const url = new URL(path, origin);
    if (url.origin !== origin || !path.startsWith("/v1/") || !url.pathname.startsWith("/v1/") || url.hash) {
      throw new Error("Invalid Cheapo API path.");
    }
    return url;
  }

  async function requiredCredential(): Promise<string> {
    const credential = await loadCredential();
    if (!credential) throw new CheapoAccessError("Ask your operator to connect this phone to Cheapo.");
    return credential;
  }

  async function authenticatedRequest(url: URL, credential: string, init?: RequestInit): Promise<Response> {
    const response = await send(url, credential, init);
    if (response.status === 401 || response.status === 403) {
      throw new CheapoAccessError("Cheapo access ended. Ask your operator for a replacement.");
    }
    return response;
  }

  return {
    async check(): Promise<AccessState> {
      const credential = await loadCredential();
      return credential ? probe(credential) : "missing";
    },
    async enroll(input: string) {
      const credential = input.trim();
      if (!credentialFormat.test(credential)) {
        throw new CheapoAccessError("Enter the credential provided by your operator.");
      }
      const access = await probe(credential);
      if (access === "denied") throw new CheapoAccessError("Cheapo declined this credential. Ask your operator for a replacement.");
      if (access !== "connected") throw new CheapoAccessError("Could not reach Cheapo. Try again when you’re online.");
      await storage.setItem(storageKey, JSON.stringify({ origin, credential }));
      enrollmentRevision++;
    },
    async clear() {
      await storage.deleteItem(storageKey);
      enrollmentRevision++;
    },
    async request(path: string, init?: RequestInit): Promise<Response> {
      const url = apiUrl(path);
      return authenticatedRequest(url, await requiredCredential(), init);
    },
    async openReadSession(): Promise<CheapoReadSession> {
      if (!digestCacheScope) throw Error("Cheapo shopping reads are unavailable in this build.");
      const revision = enrollmentRevision;
      const credential = await requiredCredential();
      // Bind the request and its cache partition to the same protected enrollment.
      const cacheScope = await digestCacheScope(`cheapo-shopping-cache-v1\0${origin}\0${credential}`);
      function confirmEnrollment() {
        if (revision !== enrollmentRevision) throw new CheapoAccessError("Cheapo access changed. Try again.");
      }
      confirmEnrollment();
      return {
        cacheScope,
        assertCurrent: confirmEnrollment,
        get(path, signal) {
          confirmEnrollment();
          return authenticatedRequest(apiUrl(path), credential, { method: "GET", signal });
        },
      };
    },
  };
}

export type CheapoAccess = ReturnType<typeof createCheapoAccess>;
