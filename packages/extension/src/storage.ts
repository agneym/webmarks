import { DEFAULT_BASE_URL } from "./config";

/** A bearer session token, bound to the server that issued it. */
export type Session = { baseUrl: string; token: string; email?: string };

/** An in-progress device login, shown by the popup while the worker polls. */
export type LoginState =
  | {
      status: "pending";
      baseUrl: string;
      deviceCode: string;
      userCode: string;
      verificationUri: string;
      interval: number;
      expiresAt: number;
    }
  | { status: "error"; message: string };

type Shape = { baseUrl?: string; session?: Session; login?: LoginState };

// chrome.storage.local (not sync): the token stays on this machine.
const area = () => chrome.storage.local;

export async function getBaseUrl(): Promise<string> {
  const { baseUrl } = (await area().get("baseUrl")) as Shape;
  return baseUrl ?? DEFAULT_BASE_URL;
}

export async function setBaseUrl(baseUrl: string): Promise<void> {
  await area().set({ baseUrl });
  // A token from one server must never be sent to another.
  const session = await getSession(baseUrl);
  if (!session) await area().remove("session");
}

/** The stored session, or null when there is none for `baseUrl`. */
export async function getSession(baseUrl: string): Promise<Session | null> {
  const { session } = (await area().get("session")) as Shape;
  return session && session.baseUrl === baseUrl ? session : null;
}

export async function setSession(session: Session): Promise<void> {
  await area().set({ session });
}

export async function clearSession(): Promise<void> {
  await area().remove("session");
}

export async function getLogin(): Promise<LoginState | null> {
  const { login } = (await area().get("login")) as Shape;
  return login ?? null;
}

export async function setLogin(login: LoginState | null): Promise<void> {
  if (login) await area().set({ login });
  else await area().remove("login");
}
