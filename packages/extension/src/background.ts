// Service worker: runs the device-login poll so it survives the popup closing
// when the approval tab takes focus.
import { pollDecision, pollToken, requestDeviceCode } from "./device";
import { getBaseUrl, getLogin, setLogin, setSession } from "./storage";

export type Message = { type: "login" } | { type: "cancel-login" };

let polling = false;

async function startLogin(): Promise<void> {
  const baseUrl = await getBaseUrl();
  try {
    const dc = await requestDeviceCode(baseUrl);
    await setLogin({
      status: "pending",
      baseUrl,
      deviceCode: dc.device_code,
      userCode: dc.user_code,
      verificationUri: dc.verification_uri_complete || dc.verification_uri,
      interval: Math.max(dc.interval, 1),
      expiresAt: Date.now() + dc.expires_in * 1000,
    });
    await chrome.tabs.create({ url: dc.verification_uri_complete || dc.verification_uri });
    void poll();
  } catch (err) {
    await setLogin({ status: "error", message: (err as Error).message });
  }
}

// Polling is inherently sequential: each request waits for the previous one.
/* oxlint-disable no-await-in-loop */
async function poll(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    for (;;) {
      const login = await getLogin();
      if (login?.status !== "pending") return;
      if (Date.now() > login.expiresAt) {
        await setLogin({ status: "error", message: "The sign-in code expired, try again" });
        return;
      }
      await new Promise((r) => setTimeout(r, login.interval * 1000));
      // Re-read: the user may have cancelled while we slept.
      const current = await getLogin();
      if (current?.status !== "pending" || current.deviceCode !== login.deviceCode) return;

      let decision;
      try {
        const res = await pollToken(login.baseUrl, login.deviceCode);
        decision = pollDecision(res.status, res.body, login.interval);
      } catch {
        continue; // Transient network error: keep polling until expiry.
      }
      if (decision.kind === "success") {
        await setSession({ baseUrl: login.baseUrl, token: decision.token });
        await setLogin(null);
        return;
      }
      if (decision.kind === "fatal") {
        await setLogin({ status: "error", message: decision.message });
        return;
      }
      if (decision.interval !== login.interval) {
        await setLogin({ ...login, interval: decision.interval });
      }
    }
  } finally {
    polling = false;
  }
}
/* oxlint-enable no-await-in-loop */

chrome.runtime.onMessage.addListener((msg: Message) => {
  if (msg.type === "login") void startLogin();
  if (msg.type === "cancel-login") void setLogin(null);
});

// The worker can be stopped mid-login; pick the poll back up when it restarts.
void poll();
