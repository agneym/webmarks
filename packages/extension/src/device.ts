/**
 * RFC 8628 device authorization against Better Auth, the same flow the CLI
 * uses (`webmarks login`), so the backend needs no extension-specific auth.
 */

export const CLIENT_ID = "webmarks-extension";

export type DeviceCode = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

export type PollDecision =
  | { kind: "success"; token: string }
  | { kind: "pending"; interval: number }
  | { kind: "fatal"; message: string };

export async function requestDeviceCode(baseUrl: string, fetchFn = fetch): Promise<DeviceCode> {
  const res = await fetchFn(`${baseUrl}/api/auth/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: "openid profile email" }),
  });
  if (!res.ok) throw new Error(`Could not start sign-in (HTTP ${res.status})`);
  return (await res.json()) as DeviceCode;
}

export async function pollToken(baseUrl: string, deviceCode: string, fetchFn = fetch) {
  const res = await fetchFn(`${baseUrl}/api/auth/device/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: CLIENT_ID,
    }),
  });
  return { status: res.status, body: await res.text() };
}

/** Map one token-endpoint response to what the poller should do next. */
export function pollDecision(status: number, body: string, interval: number): PollDecision {
  let json: { access_token?: string; error?: string } = {};
  try {
    json = JSON.parse(body);
  } catch {
    // Non-JSON bodies fall through to the generic error below.
  }
  if (status === 200) {
    return json.access_token
      ? { kind: "success", token: json.access_token }
      : { kind: "fatal", message: "Sign-in failed: no token in the server response" };
  }
  switch (json.error) {
    case "authorization_pending":
      return { kind: "pending", interval };
    case "slow_down":
      return { kind: "pending", interval: interval + 5 };
    case "access_denied":
      return { kind: "fatal", message: "Sign-in was denied" };
    case "expired_token":
      return { kind: "fatal", message: "The sign-in code expired, try again" };
    case "invalid_grant":
      return { kind: "fatal", message: "Invalid sign-in code, try again" };
    default:
      return { kind: "fatal", message: `Sign-in failed (HTTP ${status})` };
  }
}
