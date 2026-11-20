const storageKey = "cheapo-api.device-credential";
const credentialFormat = /^cheapo_[A-Za-z0-9_-]{43}$/;
const checkPath = "/v1/me/comparison-preferences/__cheapo-device-enrollment__";

type ProtectedStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
};
type Transport = (url: string, init: RequestInit) => Promise<Response>;
export type AccessState = "missing" | "connected" | "denied" | "unavailable";

export class CheapoAccessError extends Error {}

export function parseCheapoApiOrigin(value: unknown): string | null {
  if (typeof value !== "string" || !/^https:\/\/[^/?#\\\s]+\/?$/i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.username || url.password ? null : url.origin;
  } catch {
    return null;
  }
}

export function createCheapoAccess(originValue: string, storage: ProtectedStorage, transport: Transport) {
  const origin = parseCheapoApiOrigin(originValue);
  if (!origin) throw new Error("Invalid Cheapo API origin.");
  const probeUrl = new URL(checkPath, origin);

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
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await send(probeUrl, credential, { signal: controller.signal });
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
    },
    clear() {
      return storage.deleteItem(storageKey);
    },
    async request(path: string, init?: RequestInit): Promise<Response> {
      const url = new URL(path, origin);
      if (url.origin !== origin || !path.startsWith("/v1/") || !url.pathname.startsWith("/v1/") || url.hash) {
        throw new Error("Invalid Cheapo API path.");
      }
      const credential = await loadCredential();
      if (!credential) throw new CheapoAccessError("Ask your operator to connect this phone to Cheapo.");
      const response = await send(url, credential, init);
      if (response.status === 401 || response.status === 403) {
        throw new CheapoAccessError("Cheapo access ended. Ask your operator for a replacement.");
      }
      return response;
    },
  };
}

export type CheapoAccess = ReturnType<typeof createCheapoAccess>;
