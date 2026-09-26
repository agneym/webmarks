//! Browser-less device login (RFC 8628 Device Authorization Grant).
//!
//! Flow:
//!  1. POST `{base}/api/auth/device/code` with client_id + scope.
//!  2. Print `verification_uri_complete` (or `verification_uri`) and the
//!     user code, optionally opening a browser.
//!  3. Poll POST `{base}/api/auth/device/token` with
//!     grant_type=device_code every `interval` seconds until success,
//!     expiry, or denial.
//!  4. Store the returned access_token as the session token.

use std::time::Duration;

use anyhow::{bail, Context};
use serde::Deserialize;

use crate::api::Client;
use crate::config::Config;

const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const CLIENT_ID: &str = "webmarks-cli";
const SLOW_DOWN_PENALTY_SECS: u64 = 5;

/// Outcome of classifying a single token-poll HTTP response.
///
/// Extracted as a pure function of `(status, body, current_interval)` so
/// the state machine can be unit-tested without any network.
#[derive(Debug, Clone, PartialEq, Eq)]
enum PollDecision {
    /// The user approved; we hold the session token.
    Success { access_token: String },
    /// Keep polling at the given interval.
    Pending { interval: u64 },
    /// Server asked us to slow down; poll again at the new interval.
    SlowDown { interval: u64 },
    /// Stop immediately with this human-readable message.
    Fatal(String),
}

/// Map one token-endpoint response onto the next polling action.
fn poll_decision(status: u16, body: &str, interval: u64) -> PollDecision {
    let parsed: Option<TokenPollResponse> = serde_json::from_str(body).ok();

    // 200: approved — anything else is an unexpected response shape.
    if status == 200 {
        return match parsed.and_then(|r| r.access_token) {
            Some(token) => PollDecision::Success {
                access_token: token,
            },
            None => PollDecision::Fatal(
                "device login failed: unexpected 200 response from token endpoint".into(),
            ),
        };
    }

    let error_code = parsed.and_then(|r| r.error).unwrap_or_default();
    match error_code.as_str() {
        "authorization_pending" => PollDecision::Pending { interval },
        "slow_down" => PollDecision::SlowDown {
            interval: interval + SLOW_DOWN_PENALTY_SECS,
        },
        "expired_token" => {
            PollDecision::Fatal("device code expired — restart `webmarks login`".into())
        }
        "access_denied" => PollDecision::Fatal(
            "authorization was denied in the browser — restart `webmarks login`".into(),
        ),
        "invalid_grant" => {
            PollDecision::Fatal("invalid device code (already used or revoked)".into())
        }
        other => PollDecision::Fatal(format!(
            "device login failed (HTTP {status}): {}",
            if other.is_empty() {
                format!("unparsable response body: {body}")
            } else {
                format!("server returned error \"{other}\"")
            }
        )),
    }
}

/// Body of the POST /api/auth/device/code response.
#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    #[serde(default)]
    verification_uri_complete: Option<String>,
    #[allow(dead_code)]
    expires_in: Option<u64>,
    #[serde(default = "default_interval")]
    interval: u64,
}

fn default_interval() -> u64 {
    5
}

/// Subset of fields we care about in the token-poll response.
#[derive(Debug, Default, Deserialize)]
struct TokenPollResponse {
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

/// Run the interactive device-flow login and persist the session token.
pub async fn run_login(client: &Client, _cfg: &Config, no_open: bool) -> anyhow::Result<()> {
    let base_url = client.base_url().trim_end_matches('/');

    // 1. Request the device/user codes from the Better Auth backend.
    //    Better Auth's endpoints accept JSON bodies (the Hono validators reject
    //     form-encoding), so send application/json like the official client does.
    let resp = reqwest::Client::new()
        .post(format!("{base_url}/api/auth/device/code"))
        .json(&serde_json::json!({
            "client_id": CLIENT_ID,
            "scope": "openid profile email",
        }))
        .send()
        .await
        .context("failed to reach the server's device-code endpoint")?;

    let status = resp.status();
    let body = resp.text().await?;
    if !status.is_success() {
        bail!("device authorization failed (HTTP {status}): {body}");
    }
    let dc: DeviceCodeResponse = serde_json::from_str(&body)
        .with_context(|| format!("unexpected device-code response: {body}"))?;

    // 2. Show / open the verification URL.
    let complete = dc
        .verification_uri_complete
        .clone()
        .filter(|u| !u.is_empty());
    let print_url = complete
        .clone()
        .unwrap_or_else(|| dc.verification_uri.clone());

    println!("Open this URL in your browser to authorize Webmarks CLI:\n\n  {print_url}\n");
    if !no_open {
        open_browser(&print_url)?;
    }
    if complete.is_some() {
        // The auto-fill URL hides the code; give a manual fallback too.
        println!(
            "\nOr visit {} and enter code: {}",
            dc.verification_uri, dc.user_code
        );
    }
    println!("\nWaiting for approval… (5 minute timeout) Ctrl-C to cancel.");

    // 3. Poll until approved/denied/expired or overall timeout.
    let deadline = std::time::Instant::now() + LOGIN_TIMEOUT;
    let mut interval = dc.interval.max(1);
    loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        if std::time::Instant::now() >= deadline {
            bail!("timed out waiting for device approval (5 minutes)");
        }

        let resp = reqwest::Client::new()
            .post(format!("{base_url}/api/auth/device/token"))
            .json(&serde_json::json!({
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "device_code": dc.device_code,
                "client_id": CLIENT_ID,
            }))
            .send()
            .await
            .context("failed to reach the server's device-token endpoint")?;
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();

        match poll_decision(status, &body, interval) {
            PollDecision::Success { access_token } => {
                let mut cfg = Config::load()?;
                cfg.session_token = Some(access_token);
                cfg.save()?;
                println!("Logged in.");
                return Ok(());
            }
            PollDecision::Pending { interval: i } => interval = i,
            PollDecision::SlowDown { interval: i } => {
                eprintln!("Server asked us to slow down; adjusting poll interval to {i}s…");
                interval = i;
            }
            PollDecision::Fatal(msg) => bail!("{msg}"),
        }
    }
}

#[cfg(unix)]
fn open_browser(url: &str) -> anyhow::Result<()> {
    // xdg-open exists on Linux desktops; on headless boxes it fails, which is fine:
    // the URL is printed above so the user can open it manually.
    match std::process::Command::new("xdg-open")
        .arg(url)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
    {
        Ok(s) if s.success() => Ok(()),
        _ => {
            println!("(Could not launch a browser automatically — open the URL above manually.)");
            Ok(())
        }
    }
}

#[cfg(not(unix))]
fn open_browser(_url: &str) -> anyhow::Result<()> {
    println!("Automatic browser opening is unsupported here; open the URL above manually.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decision(status: u16, body: &str, interval: u64) -> PollDecision {
        poll_decision(status, body, interval)
    }

    #[test]
    fn success_when_200_with_access_token() {
        let d = decision(200, r#"{"access_token":"tok123"}"#, 5);
        assert_eq!(
            d,
            PollDecision::Success {
                access_token: "tok123".into()
            }
        );
    }

    #[test]
    fn pending_keeps_polling_at_same_interval() {
        let d = decision(400, r#"{"error":"authorization_pending"}"#, 7);
        assert_eq!(d, PollDecision::Pending { interval: 7 });
    }

    #[test]
    fn slow_down_increases_interval_by_five() {
        let d = decision(400, r#"{"error":"slow_down"}"#, 5);
        assert_eq!(d, PollDecision::SlowDown { interval: 10 });
    }

    #[test]
    fn expired_token_is_fatal() {
        let d = decision(400, r#"{"error":"expired_token"}"#, 5);
        assert!(
            matches!(&d, PollDecision::Fatal(m) if m.contains("expired")),
            "got {d:?}"
        );
    }

    #[test]
    fn access_denied_is_fatal() {
        let d = decision(400, r#"{"error":"access_denied"}"#, 5);
        assert!(
            matches!(&d, PollDecision::Fatal(m) if m.contains("denied")),
            "got {d:?}"
        );
    }

    #[test]
    fn invalid_grant_is_fatal() {
        let d = decision(400, r#"{"error":"invalid_grant"}"#, 5);
        assert!(matches!(d, PollDecision::Fatal(_)));
    }

    #[test]
    fn unexpected_error_is_fatal_with_status_and_body() {
        let d = decision(500, r#"{"error":"boom"}"#, 5);
        assert!(
            matches!(&d, PollDecision::Fatal(m) if m.contains("500") && m.contains("boom")),
            "got {d:?}"
        );
    }

    #[test]
    fn unparsable_error_body_is_fatal() {
        let d = decision(403, "<html>nope</html>", 5);
        assert!(matches!(d, PollDecision::Fatal(_)));
    }

    #[test]
    fn slow_down_accumulates_from_current_interval() {
        // Two slow_downs in a row must keep growing, not reset to base+5.
        assert_eq!(
            decision(400, r#"{"error":"slow_down"}"#, 15),
            PollDecision::SlowDown { interval: 20 }
        );
    }
}
