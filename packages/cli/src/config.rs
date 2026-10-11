use std::fs;
use std::os::unix::fs::PermissionsExt;

use serde::{Deserialize, Serialize};

/// Source of the Bookmark/Tag shapes:
/// packages/backend/src/routes/bookmarks/schemas.ts
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: String,
    pub url: String,
    pub user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favicon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetch_status: Option<FetchStatus>,
    pub visibility: Visibility,
    #[serde(default)]
    pub tags: Vec<Tag>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum FetchStatus {
    Pending,
    Success,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Visibility {
    Public,
    Private,
}

/// GET /api/bookmarks response shape (cursor-paginated).
///
/// `next_cursor` is opaque: pass it back verbatim to fetch the next page.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkListResponse {
    pub bookmarks: Vec<Bookmark>,
    pub total: i64,
    pub limit: i64,
    #[serde(default)]
    pub next_cursor: Option<String>,
    #[serde(default)]
    pub has_more: bool,
}

#[derive(Debug, Default, Clone, Deserialize, Serialize)]
pub struct Config {
    /// Base URL the stored `session_token` was issued by. Written by
    /// `webmarks login`; absent in configs from older CLI versions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_token: Option<String>,
}

pub const DEFAULT_BASE_URL: &str = "http://localhost:8787";
pub const BASE_URL_ENV: &str = "WEBMARKS_BASE_URL";

/// Resolve the API base URL with precedence:
/// `--base-url` flag > `WEBMARKS_BASE_URL` > saved config `base_url` > localhost.
///
/// Empty values are treated as unset; trailing slashes are stripped.
pub fn resolve_base_url(flag: Option<&str>, env: Option<&str>, saved: Option<&str>) -> String {
    [flag, env, saved]
        .into_iter()
        .flatten()
        .map(normalize_base_url)
        .find(|u| !u.is_empty())
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string())
}

fn normalize_base_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

/// The saved token was issued by a different server than the one this
/// command would send it to. We refuse rather than warn: by the time a
/// warning is printed the bearer token has already left for the other host.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
#[error(
    "the saved session token belongs to {saved}, but this command would send it to {effective}; \
     refusing to send it to a different server"
)]
pub struct BaseUrlMismatch {
    pub saved: String,
    pub effective: String,
}

impl BaseUrlMismatch {
    pub fn fix_hint(&self) -> String {
        format!(
            "drop --base-url / unset {BASE_URL_ENV} to use {}, or run `webmarks login --base-url {}` to sign in there",
            self.saved, self.effective
        )
    }
}

/// Outcome of checking whether the saved token may be sent to `effective`.
#[derive(Debug, PartialEq, Eq)]
pub enum TokenUse {
    /// No token stored, or it was issued by `effective`.
    Ok,
    /// Token from an older config that never recorded its base URL; we
    /// can't tell where it belongs, so send it but say so on stderr.
    Unpinned,
}

pub fn check_token_base_url(cfg: &Config, effective: &str) -> Result<TokenUse, BaseUrlMismatch> {
    if cfg.session_token.is_none() {
        return Ok(TokenUse::Ok);
    }
    match cfg.base_url.as_deref().map(normalize_base_url) {
        Some(saved) if !saved.is_empty() => {
            let effective = normalize_base_url(effective);
            if saved == effective {
                Ok(TokenUse::Ok)
            } else {
                Err(BaseUrlMismatch { saved, effective })
            }
        }
        _ => Ok(TokenUse::Unpinned),
    }
}

impl Config {
    /// Path of the config file: <config_dir>/webmarks/config.json
    pub fn path() -> anyhow::Result<std::path::PathBuf> {
        let dir = dirs::config_dir()
            .ok_or_else(|| anyhow::anyhow!("cannot determine user config directory"))?
            .join("webmarks");
        Ok(dir.join("config.json"))
    }

    /// Load the config if it exists; missing file yields the default config.
    pub fn load() -> anyhow::Result<Config> {
        Self::load_from(&Self::path()?)
    }

    fn load_from(path: &std::path::Path) -> anyhow::Result<Config> {
        if !path.exists() {
            return Ok(Config::default());
        }
        let raw = fs::read_to_string(path)?;
        Ok(serde_json::from_str(&raw)?)
    }

    fn ensure_dir(path: &std::path::Path) -> anyhow::Result<()> {
        let dir = path.parent().expect("config path has a parent");
        fs::create_dir_all(dir)?;
        // Directory should be private too.
        let mut perms = fs::metadata(dir)?.permissions();
        perms.set_mode(0o700);
        fs::set_permissions(dir, perms)?;
        Ok(())
    }

    pub fn save(&self) -> anyhow::Result<()> {
        self.save_to(&Self::path()?)
    }

    fn save_to(&self, path: &std::path::Path) -> anyhow::Result<()> {
        Self::ensure_dir(path)?;

        // Refuse to silently loosen an existing file's permissions.
        if path.exists() {
            let mode = fs::metadata(path)?.permissions().mode() & 0o777;
            if mode & 0o077 != 0 {
                anyhow::bail!(
                    "refusing to overwrite {} with permissive permissions ({:o}); fix with chmod 600",
                    path.display(),
                    mode
                );
            }
        }

        let json = serde_json::to_string_pretty(self)?;
        fs::write(path, json)?;

        let mut perms = fs::metadata(path)?.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(path, perms)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sample_bookmark_json_from_backend_schema() {
        let raw = r#"{
            "id": "01a03f4f-074d-730e-8cd7-4101a2c73c49",
            "url": "https://example.com",
            "userId": "01a03f4e-de9f-75ae-ad3b-73f0eaf88705",
            "title": "Example Domain",
            "description": null,
            "image": null,
            "favicon": "data:,",
            "fetchStatus": "success",
            "visibility": "public",
            "tags": [{ "id": "tag1", "name": "work" }]
        }"#;
        let bm: Bookmark = serde_json::from_str(raw).expect("bookmark should parse");
        assert_eq!(bm.visibility, Visibility::Public);
        assert_eq!(bm.fetch_status, Some(FetchStatus::Success));
        assert_eq!(bm.tags.len(), 1);
        assert_eq!(bm.tags[0].name, "work");
    }

    #[test]
    fn list_response_defaults_cursor_fields_when_absent() {
        // `nextCursor` / `hasMore` are optional on the wire: a body without them
        // must parse as the last page rather than fail.
        let raw = r#"{
            "bookmarks": [],
            "total": 0,
            "limit": 50
        }"#;
        let resp: BookmarkListResponse = serde_json::from_str(raw).unwrap();
        assert_eq!(resp.total, 0);
        assert!(resp.next_cursor.is_none());
        assert!(!resp.has_more);
    }

    #[test]
    fn list_response_parses_middle_page_with_cursor() {
        let raw = r#"{
            "bookmarks": [],
            "total": 120,
            "limit": 50,
            "nextCursor": "eyJzIjoibmV3ZXN0IiwiaSI6ImJtLTEifQ",
            "hasMore": true
        }"#;
        let resp: BookmarkListResponse = serde_json::from_str(raw).unwrap();
        assert_eq!(resp.total, 120);
        assert_eq!(
            resp.next_cursor.as_deref(),
            Some("eyJzIjoibmV3ZXN0IiwiaSI6ImJtLTEifQ")
        );
        assert!(resp.has_more);
    }

    #[test]
    fn save_creates_config_with_0600() {
        // Work on an explicit path under a fresh temp dir instead of redirecting
        // HOME: `dirs::config_dir()` prefers XDG_CONFIG_HOME, so changing HOME
        // alone could still write over the real config.
        let tmp = std::env::temp_dir().join(format!(
            "webmarks-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        let path = tmp.join("webmarks").join("config.json");

        let cfg = Config {
            session_token: Some("secret-token".into()),
            base_url: None,
        };
        let result = cfg.save_to(&path).and_then(|()| {
            let mode = fs::metadata(&path)?.permissions().mode() & 0o777;
            let dir_mode = fs::metadata(path.parent().unwrap())?.permissions().mode() & 0o777;
            Ok((mode, dir_mode, Config::load_from(&path)?))
        });
        let _ = fs::remove_dir_all(&tmp);

        let (mode, dir_mode, loaded) = result.unwrap();
        assert_eq!(mode, 0o600);
        assert_eq!(dir_mode, 0o700);
        assert_eq!(loaded.session_token.as_deref(), Some("secret-token"));
    }

    fn temp_config_path(tag: &str) -> std::path::PathBuf {
        let tmp = std::env::temp_dir().join(format!(
            "webmarks-test-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        tmp.join("webmarks").join("config.json")
    }

    #[test]
    fn config_round_trips_base_url_and_token_with_0600() {
        let path = temp_config_path("roundtrip");
        let cfg = Config {
            base_url: Some("https://backend.example.dev".into()),
            session_token: Some("tok-abc".into()),
        };
        let result = cfg.save_to(&path).and_then(|()| {
            let raw = fs::read_to_string(&path)?;
            let mode = fs::metadata(&path)?.permissions().mode() & 0o777;
            Ok((raw, mode, Config::load_from(&path)?))
        });
        let _ = fs::remove_dir_all(path.parent().unwrap().parent().unwrap());

        let (raw, mode, loaded) = result.unwrap();
        assert_eq!(mode, 0o600);
        // On-disk key names are part of the compat contract.
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(json["base_url"], "https://backend.example.dev");
        assert_eq!(json["session_token"], "tok-abc");
        assert_eq!(
            loaded.base_url.as_deref(),
            Some("https://backend.example.dev")
        );
        assert_eq!(loaded.session_token.as_deref(), Some("tok-abc"));
    }

    #[test]
    fn loads_legacy_config_without_base_url() {
        let path = temp_config_path("legacy");
        let result = Config::ensure_dir(&path)
            .and_then(|()| Ok(fs::write(&path, r#"{"session_token":"old-tok"}"#)?))
            .and_then(|()| Config::load_from(&path));
        let _ = fs::remove_dir_all(path.parent().unwrap().parent().unwrap());

        let cfg = result.unwrap();
        assert_eq!(cfg.session_token.as_deref(), Some("old-tok"));
        assert!(cfg.base_url.is_none());
        // An unpinned legacy token is still usable (with a warning), not rejected.
        assert_eq!(
            check_token_base_url(&cfg, "https://anything.example"),
            Ok(TokenUse::Unpinned)
        );
    }

    #[test]
    fn loads_empty_object_config() {
        let cfg: Config = serde_json::from_str("{}").unwrap();
        assert!(cfg.base_url.is_none() && cfg.session_token.is_none());
    }

    #[test]
    fn resolution_precedence_flag_env_saved_default() {
        let (flag, env, saved) = (
            Some("https://flag.example"),
            Some("https://env.example"),
            Some("https://saved.example"),
        );
        assert_eq!(resolve_base_url(flag, env, saved), "https://flag.example");
        assert_eq!(resolve_base_url(None, env, saved), "https://env.example");
        assert_eq!(resolve_base_url(None, None, saved), "https://saved.example");
        assert_eq!(resolve_base_url(None, None, None), DEFAULT_BASE_URL);
        // Flag still wins when env is unset.
        assert_eq!(resolve_base_url(flag, None, saved), "https://flag.example");
    }

    #[test]
    fn resolution_skips_empty_values_and_strips_trailing_slash() {
        assert_eq!(
            resolve_base_url(Some(""), Some(""), Some("https://saved.example/")),
            "https://saved.example"
        );
        assert_eq!(resolve_base_url(None, Some("  "), None), DEFAULT_BASE_URL);
    }

    #[test]
    fn token_check_allows_matching_base_url_modulo_trailing_slash() {
        let cfg = Config {
            base_url: Some("https://prod.example/".into()),
            session_token: Some("t".into()),
        };
        assert_eq!(
            check_token_base_url(&cfg, "https://prod.example"),
            Ok(TokenUse::Ok)
        );
    }

    #[test]
    fn token_check_rejects_different_base_url() {
        let cfg = Config {
            base_url: Some("https://prod.example".into()),
            session_token: Some("t".into()),
        };
        let err = check_token_base_url(&cfg, "http://localhost:8787").unwrap_err();
        assert_eq!(err.saved, "https://prod.example");
        assert_eq!(err.effective, "http://localhost:8787");
        assert!(err.fix_hint().contains("--base-url http://localhost:8787"));
    }

    #[test]
    fn token_check_ignores_base_url_when_no_token() {
        let cfg = Config {
            base_url: Some("https://prod.example".into()),
            session_token: None,
        };
        assert_eq!(
            check_token_base_url(&cfg, "http://localhost:8787"),
            Ok(TokenUse::Ok)
        );
    }
}
