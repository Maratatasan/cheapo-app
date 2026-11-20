import { parseCheapoApiOrigin } from "./origin";

const storageKey = "cheapo-api.device-credential";
const credentialFormat = /^cheapo_[A-Za-z0-9_-]{43}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
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
type ShoppingIdentity = { householdId: string; shopperId: string };
type Enrollment = { origin: string; credential: string; identity?: ShoppingIdentity };
type Probe = { state: "connected"; identity: ShoppingIdentity } | { state: "denied" | "unavailable" };

function readIdentity(value: unknown): ShoppingIdentity | undefined {
  if (!value || typeof value !== "object") return;
  const { householdId, shopperId } = value as Partial<ShoppingIdentity>;
  if (typeof householdId === "string" && uuid.test(householdId) && typeof shopperId === "string" && uuid.test(shopperId)) {
    return { householdId, shopperId };
  }
}

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
  const probeUrl = new URL("/v1/me", origin);
  const appendUrl = new URL("/v1/me/price-observations", origin);
  let enrollmentRevision = 0;
  let pendingEnrollmentWrite: Promise<unknown> = Promise.resolve();

  async function loadEnrollment(): Promise<Enrollment | null> {
    await pendingEnrollmentWrite;
    const stored = await storage.getItem(storageKey);
    if (!stored) return null;
    try {
      const value = JSON.parse(stored);
      if (value?.origin !== origin || typeof value.credential !== "string" || !credentialFormat.test(value.credential)) return null;
      return { origin, credential: value.credential, identity: readIdentity(value.identity) };
    } catch {
      return null;
    }
  }

  function send(url: URL, credential: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${credential}`);
    return transport(url.href, { ...init, headers, redirect: "error", credentials: "omit" });
  }

  async function probe(credential: string): Promise<Probe> {
    const controller = new AbortController();
    const startedAt = Date.now();
    const timeout = setTimeout(() => controller.abort(), checkDeadlineMs);
      const options = { method: "GET", signal: controller.signal };
    try {
      let response = await send(probeUrl, credential, options);
      // A read-only check can wait for a paused backend to resume and retry once.
      if (response.status === 503 && Date.now() - startedAt < checkDeadlineMs / 2) {
        await new Promise<void>(resolve => setTimeout(resolve, checkRetryDelayMs));
        if (!controller.signal.aborted) response = await send(probeUrl, credential, options);
      }
      if (response.status === 401 || response.status === 403) return { state: "denied" };
      if (!response.ok) return { state: "unavailable" };
      const identity = readIdentity(await response.json());
      return identity ? { state: "connected", identity } : { state: "unavailable" };
    } catch {
      return { state: "unavailable" };
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

  function assertEnrollment(revision: number) {
    if (revision !== enrollmentRevision) throw new CheapoAccessError("Cheapo access changed. Try again.");
  }

  async function requiredEnrollment(revision: number) {
    const enrollment = await loadEnrollment();
    assertEnrollment(revision);
    if (!enrollment) throw new CheapoAccessError("Ask your operator to connect this phone to Cheapo.");
    return enrollment;
  }

  function writeEnrollment(revision: number, enrollment?: Enrollment, replacement = false) {
    const pending = pendingEnrollmentWrite.then(async () => {
      assertEnrollment(revision);
      // A session can still use the previous enrollment while a replacement
      // is being checked. Invalidate it again when the replacement is stored.
      const committedRevision = replacement ? ++enrollmentRevision : revision;
      if (enrollment) await storage.setItem(storageKey, JSON.stringify(enrollment));
      else await storage.deleteItem(storageKey);
      return committedRevision;
    });
    pendingEnrollmentWrite = pending.catch(() => {});
    return pending;
  }

  async function verifyEnrollment(enrollment: Enrollment, revision: number) {
    const checked = await probe(enrollment.credential);
    assertEnrollment(revision);
    if (checked.state !== "connected") return checked;
    if (enrollment.identity) {
      if (enrollment.identity.householdId !== checked.identity.householdId || enrollment.identity.shopperId !== checked.identity.shopperId) {
        throw new CheapoAccessError("Cheapo access changed. Ask your operator to check this phone’s enrollment.");
      }
    } else {
      await writeEnrollment(revision, { ...enrollment, identity: checked.identity });
      assertEnrollment(revision);
    }
    return checked;
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
      const revision = enrollmentRevision;
      try {
        const enrollment = await loadEnrollment();
        assertEnrollment(revision);
        return enrollment ? (await verifyEnrollment(enrollment, revision)).state : "missing";
      } catch {
        return "unavailable";
      }
    },
    async enroll(input: string) {
      const credential = input.trim();
      if (!credentialFormat.test(credential)) {
        throw new CheapoAccessError("Enter the credential provided by your operator.");
      }
      const revision = ++enrollmentRevision;
      const checked = await probe(credential);
      assertEnrollment(revision);
      if (checked.state === "denied") throw new CheapoAccessError("Cheapo declined this credential. Ask your operator for a replacement.");
      if (checked.state !== "connected") throw new CheapoAccessError("Could not reach Cheapo. Try again when you’re online.");
      const committedRevision = await writeEnrollment(revision, { origin, credential, identity: checked.identity }, true);
      assertEnrollment(committedRevision);
    },
    async clear() {
      await writeEnrollment(++enrollmentRevision);
    },
    async request(path: string, init?: RequestInit): Promise<Response> {
      const url = apiUrl(path);
      const revision = enrollmentRevision;
      const { credential } = await requiredEnrollment(revision);
      assertEnrollment(revision);
      return authenticatedRequest(url, credential, init);
    },
    async openReadSession(): Promise<CheapoReadSession> {
      if (!digestCacheScope) throw Error("Cheapo shopping reads are unavailable in this build.");
      const revision = enrollmentRevision;
      const { credential } = await requiredEnrollment(revision);
      // Bind the request and its cache partition to the same protected enrollment.
      const cacheScope = await digestCacheScope(`cheapo-shopping-cache-v1\0${origin}\0${credential}`);
      const confirmEnrollment = () => assertEnrollment(revision);
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
    async lastVerifiedOwner() {
      const revision = enrollmentRevision;
      const enrollment = await loadEnrollment();
      assertEnrollment(revision);
      return enrollment?.identity ? { origin, ...enrollment.identity } : null;
    },
    async openPriceAppendSession() {
      const revision = enrollmentRevision;
      const enrollment = await requiredEnrollment(revision);
      const checked = await verifyEnrollment(enrollment, revision);
      if (checked.state === "denied") throw new CheapoAccessError("Cheapo access ended. Ask your operator for a replacement.");
      if (checked.state !== "connected") throw Error("Could not verify Cheapo access. Try again online.");
      assertEnrollment(revision);
      return {
        owner: Object.freeze({ origin, ...checked.identity }),
        async post(body: string, signal?: AbortSignal) {
          assertEnrollment(revision);
          const response = await authenticatedRequest(appendUrl, enrollment.credential, {
            method: "POST", headers: { "Content-Type": "application/json" }, body, signal,
          });
          assertEnrollment(revision);
          return response;
        },
      };
    },
  };
}

export type CheapoAccess = ReturnType<typeof createCheapoAccess>;
