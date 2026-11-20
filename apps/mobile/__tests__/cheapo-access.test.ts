import { createCheapoAccess } from "../lib/cheapo-access/client";
import { parseCheapoApiOrigin } from "../lib/cheapo-access/origin";

const origin = "https://cheapo.example";
const first = `cheapo_${"A".repeat(43)}`;
const replacement = `cheapo_${"B".repeat(43)}`;
const identity = {
  householdId: "93b93988-a027-483e-8c4d-ed58a163fbfa",
  shopperId: "d002d3a7-2744-4414-8336-afc644ec6878",
};

function fixtures(initial: string | null = null) {
  let stored: string | null = initial;
  const transport = jest.fn<Promise<Response>, [string, RequestInit]>();
  transport.mockImplementation(async () => Response.json(identity));
  const storage = {
    getItem: async () => stored,
    setItem: jest.fn(async (_key: string, value: string) => { stored = value; }),
    deleteItem: async () => { stored = null; },
  };
  return { storage, transport };
}

test("accepts only a plain, configured HTTPS origin", () => {
  expect(parseCheapoApiOrigin(origin + "/")).toBe(origin);
  for (const value of [
    undefined, "http://cheapo.example", "https://cheapo.example/api",
    "https://user:secret@cheapo.example", "https://cheapo.example?path=/",
    "https://cheapo.example/#token", "https:\\\\cheapo.example",
  ]) {
    expect(parseCheapoApiOrigin(value)).toBeNull();
  }
});

test("checks a privately delivered credential and restores it after restart", async () => {
  const { storage, transport } = fixtures();
  const connection = createCheapoAccess(origin, storage, transport);
  expect(await connection.check()).toBe("missing");
  expect(transport).not.toHaveBeenCalled();

  await connection.enroll(first + "\n");
  const [url, request] = transport.mock.calls[0];
  expect(url).toBe(`${origin}/v1/me`);
  expect(request.redirect).toBe("error");
  expect(request.credentials).toBe("omit");
  expect(new Headers(request.headers).get("Authorization")).toBe(`Bearer ${first}`);

  const restarted = createCheapoAccess(origin, storage, transport);
  expect(await restarted.lastVerifiedOwner()).toEqual({ origin, ...identity });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(await restarted.check()).toBe("connected");
  await restarted.clear();
  expect(await connection.check()).toBe("missing");
});

test("adopts a legacy enrollment only after the service verifies its IDs", async () => {
  const legacy = JSON.stringify({ origin, credential: first });
  const { storage, transport } = fixtures(legacy);
  const access = createCheapoAccess(origin, storage, transport);
  await expect(access.lastVerifiedOwner()).resolves.toBeNull();
  transport.mockRejectedValueOnce(Error("offline"));
  await expect(access.check()).resolves.toBe("unavailable");
  expect(await storage.getItem()).toBe(legacy);
  await expect(access.check()).resolves.toBe("connected");
  expect(await access.lastVerifiedOwner()).toEqual({ origin, ...identity });
  expect(JSON.parse((await storage.getItem())!)).toEqual({ origin, credential: first, identity });
});

test("binds a queued write to the credential and owner verified in the same session", async () => {
  const { storage, transport } = fixtures();
  const access = createCheapoAccess(origin, storage, transport);
  await access.enroll(first);
  const firstSession = await access.openShoppingWriteSession();
  expect(firstSession.owner).toEqual({ origin, ...identity });
  await access.enroll(replacement);
  expect(await access.lastVerifiedOwner()).toEqual(firstSession.owner);
  const serialized = JSON.stringify({ sourceId: "fixture-1" });
  const path = "/v1/me/price-observations";
  const write = { method: "POST", body: serialized };
  await expect(firstSession.request(path, write)).rejects.toThrow(/access changed/);
  expect(firstSession.assertCurrent).toThrow(/access changed/);
  const newSession = await access.openShoppingWriteSession();
  expect(newSession.owner).toEqual(firstSession.owner);
  await expect(newSession.request("https://files.example/object", write)).rejects.toThrow(/Invalid Cheapo API path/);
  await expect(newSession.request(path, { method: "GET" })).rejects.toThrow(/write method/);
  transport.mockResolvedValueOnce(new Response(null, { status: 403 }));
  await expect(newSession.request(path, write)).rejects.toThrow(/access ended/);
  const [url, request] = transport.mock.calls.at(-1)!;
  expect(url).toBe(`${origin}/v1/me/price-observations`);
  expect(request.method).toBe("POST");
  expect(request.body).toBe(serialized);
  expect(new Headers(request.headers).get("Authorization")).toBe(`Bearer ${replacement}`);
  expect(transport.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
});

test("rejects owner changes on a probe and cannot persist a legacy upgrade after clear", async () => {
  const { storage, transport } = fixtures(JSON.stringify({ origin, credential: first }));
  const access = createCheapoAccess(origin, storage, transport);
  let release!: (response: Response) => void;
  let started!: () => void;
  const startedProbe = new Promise<void>(resolve => { started = resolve; });
  transport.mockImplementationOnce(() => new Promise(resolve => { release = resolve; started(); }));
  const checking = access.check();
  await startedProbe;
  await access.clear();
  release(Response.json(identity));
  expect(await checking).toBe("unavailable");
  expect(await storage.getItem()).toBeNull();

  await access.enroll(first);
  transport.mockResolvedValueOnce(Response.json({ ...identity, shopperId: "64db4ca7-3962-4a16-8fee-782f26fd13b4" }));
  await expect(access.openShoppingWriteSession()).rejects.toThrow(/access changed/);
  expect(await access.lastVerifiedOwner()).toEqual({ origin, ...identity });
});

test("invalidates a session opened while a different enrollment was still being checked", async () => {
  const { storage, transport } = fixtures();
  const access = createCheapoAccess(origin, storage, transport);
  await access.enroll(first);
  let confirm!: (response: Response) => void;
  transport.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
  const enrolling = access.enroll(replacement);
  const previous = await access.openShoppingWriteSession();
  const different = { ...identity, shopperId: "64db4ca7-3962-4a16-8fee-782f26fd13b4" };
  confirm(Response.json(different));
  await enrolling;
  expect(await access.lastVerifiedOwner()).toEqual({ origin, ...different });
  await expect(previous.request("/v1/me/price-observations", { method: "POST", body: "{}" })).rejects.toThrow(/access changed/);
  expect(transport.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(0);
});

test("drops a shop write reply from an enrollment cleared while the request was pending", async () => {
  const { storage, transport } = fixtures();
  const access = createCheapoAccess(origin, storage, transport);
  await access.enroll(first);
  const session = await access.openShoppingWriteSession();
  let reply!: (response: Response) => void;
  transport.mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
  const writing = session.request("/v1/me/saved-shops/branch-1", { method: "PATCH", redirect: "follow", body: "{}" });
  const [url, request] = transport.mock.calls.at(-1)!;
  expect(url).toBe(`${origin}/v1/me/saved-shops/branch-1`);
  expect(request.method).toBe("PATCH");
  expect(request.redirect).toBe("error");
  expect(new Headers(request.headers).get("Authorization")).toBe(`Bearer ${first}`);

  await access.clear();
  reply(Response.json({}));
  await expect(writing).rejects.toThrow(/access changed/);
  expect(session.assertCurrent).toThrow(/access changed/);
});

test("blocks off-origin requests and cannot reuse the credential on a different build origin", async () => {
  const { storage, transport } = fixtures();
  const connection = createCheapoAccess(origin, storage, transport);
  await connection.enroll(first);
  transport.mockClear();
  for (const path of ["https://other.example/path", "//other.example/v1/shops", "/v1/../../outside"]) {
    await expect(connection.request(path)).rejects.toThrow("Invalid Cheapo API path.");
  }
  expect(await createCheapoAccess("https://other.example", storage, transport).check()).toBe("missing");
  expect(transport).not.toHaveBeenCalled();
});

test("keeps the previous credential if a replacement fails and reports revoked access", async () => {
  const { storage, transport } = fixtures();
  const connection = createCheapoAccess(origin, storage, transport);
  await connection.enroll(first);
  transport.mockResolvedValueOnce(new Response(null, { status: 401 }));
  await expect(connection.enroll(replacement)).rejects.toThrow(/replacement/);
  expect(storage.setItem).toHaveBeenCalledTimes(1);
  await expect(connection.enroll("not a Cheapo credential")).rejects.toThrow(/provided/);
  expect(await connection.check()).toBe("connected");
  expect(new Headers(transport.mock.calls.at(-1)?.[1].headers).get("Authorization")).toBe(`Bearer ${first}`);

  transport.mockResolvedValueOnce(new Response(null, { status: 403 }));
  expect(await connection.check()).toBe("denied");
  transport.mockRejectedValueOnce(new Error("internal transport detail"));
  expect(await connection.check()).toBe("unavailable");
});

test("sends subsequent API requests to the saved origin and rejects denied access", async () => {
  const { storage, transport } = fixtures();
  const connection = createCheapoAccess(origin, storage, transport);
  await expect(connection.request("/v1/shops")).rejects.toThrow(/connect this phone/);
  await connection.enroll(first);

  transport.mockResolvedValueOnce(new Response(null, { status: 401 }));
  await expect(connection.request("/v1/shops", { redirect: "follow" })).rejects.toThrow(/access ended/);
  const [url, request] = transport.mock.calls.at(-1)!;
  expect(url).toBe(origin + "/v1/shops");
  expect(request.redirect).toBe("error");
});

test("allows one delayed read-only enrollment retry when the service is unavailable", async () => {
  const { storage, transport } = fixtures();
  const connection = createCheapoAccess(origin, storage, transport);
  jest.useFakeTimers();
  try {
    transport.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const enrolling = connection.enroll(first);
    await jest.advanceTimersByTimeAsync(15_999);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(storage.setItem).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await enrolling;
    expect(transport).toHaveBeenCalledTimes(2);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
