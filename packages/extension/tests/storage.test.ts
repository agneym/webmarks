import { beforeEach, describe, expect, it } from "vitest";
import { installChromeStorage } from "./chrome-storage";
import { getBaseUrl, getSession, setBaseUrl, setSession } from "../src/storage";
import { DEFAULT_BASE_URL } from "../src/config";

describe("session storage", () => {
  let data: Record<string, unknown>;
  beforeEach(() => {
    data = installChromeStorage();
  });

  it("defaults to the production server", async () => {
    expect(await getBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  it("only hands out a token for the server that issued it", async () => {
    await setSession({ baseUrl: DEFAULT_BASE_URL, token: "t" });
    expect(await getSession(DEFAULT_BASE_URL)).toMatchObject({ token: "t" });
    expect(await getSession("http://localhost:8787")).toBeNull();
  });

  it("drops the token when switching to another server", async () => {
    await setSession({ baseUrl: DEFAULT_BASE_URL, token: "t" });
    await setBaseUrl("http://localhost:8787");
    expect(data.session).toBeUndefined();
    await setBaseUrl(DEFAULT_BASE_URL);
    expect(await getSession(DEFAULT_BASE_URL)).toBeNull();
  });
});
