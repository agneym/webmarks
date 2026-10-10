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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_token: Option<String>,
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
}
