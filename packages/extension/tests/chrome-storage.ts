/** In-memory stand-in for chrome.storage.local, enough for storage.ts. */
export function installChromeStorage() {
  const data: Record<string, unknown> = {};
  const local = {
    get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
    set: async (items: Record<string, unknown>) => void Object.assign(data, items),
    remove: async (key: string) => void delete data[key],
  };
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { local } };
  return data;
}
