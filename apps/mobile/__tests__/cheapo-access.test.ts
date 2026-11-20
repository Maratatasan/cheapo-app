import {
  createCheapoAccess,
  parseCheapoApiOrigin,
} from "../lib/cheapo-access/client";

const origin = "https://cheapo.example";
const first = `cheapo_${"A".repeat(43)}`;
const replacement = `cheapo_${"B".repeat(43)}`;

function fixtures() {
  let stored: string | null = null;
  const transport = jest.fn<Promise<Response>, [string, RequestInit]>();
  transport.mockImplementation(async () => Response.json({ basis: null }));
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
  expect(new URL(url).origin).toBe(origin);
  expect(request.redirect).toBe("error");
  expect(request.credentials).toBe("omit");
  expect(new Headers(request.headers).get("Authorization")).toBe(`Bearer ${first}`);

  const restarted = createCheapoAccess(origin, storage, transport);
  expect(await restarted.check()).toBe("connected");
  await restarted.clear();
  expect(await connection.check()).toBe("missing");
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
