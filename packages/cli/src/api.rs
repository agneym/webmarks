use anyhow::{anyhow, Context};
use serde::de::DeserializeOwned;

use crate::config::{Bookmark, BookmarkListResponse, Config, FetchStatus, Tag, Visibility};

/// Query-param strings for enums shared with the backend.
impl FetchStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            FetchStatus::Pending => "pending",
            FetchStatus::Success => "success",
            FetchStatus::Failed => "failed",
        }
    }
}

impl Visibility {
    pub fn as_str(&self) -> &'static str {
        match self {
            Visibility::Public => "public",
            Visibility::Private => "private",
        }
    }
}

/// Options for listing bookmarks (mirrors backend query params).
#[derive(Debug, Default, Clone)]
pub struct ListOpts {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub q: Option<String>,
    pub tag: Option<String>,
    pub fetch_status: Option<crate::config::FetchStatus>,
    pub visibility: Option<Visibility>,
    pub sort: Option<String>,
}

#[derive(Debug, Default, Clone)]
pub struct UpdateOpts {
    pub title: Option<String>,
    pub description: Option<String>,
    pub visibility: Option<Visibility>,
}

pub struct Client {
    http: reqwest::Client,
    base_url: String,
}

/// Typed error so exit-code mapping doesn't depend on message text.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    /// 401 from the API — user needs to run `webmarks login`.
    #[error("Unauthorized (401) — run `webmarks login`")]
    Unauthorized,
    /// Any other non-2xx response.
    #[error("API error {status}: {message}")]
    Status { status: u16, message: String },
    /// The stored session token is not a valid HTTP header value.
    #[error(
        "stored session token contains invalid header characters ({len} bytes); \
         run `webmarks logout` and `webmarks login` again"
    )]
    InvalidToken { len: usize },
}

impl ApiError {
    pub fn status(&self) -> Option<u16> {
        match self {
            ApiError::Unauthorized => Some(401),
            ApiError::Status { status, .. } => Some(*status),
            ApiError::InvalidToken { .. } => None,
        }
    }
}

/// Human-friendly error for non-2xx API responses.
fn api_error(status: u16, body: &str) -> anyhow::Error {
    let message = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from))
        .unwrap_or_else(|| body.to_string());

    if status == 401 {
        anyhow!(ApiError::Unauthorized)
    } else {
        anyhow!(ApiError::Status { status, message })
    }
}

async fn decode<T: DeserializeOwned>(resp: reqwest::Response) -> anyhow::Result<T> {
    let status = resp.status();
    let body = resp.text().await?;
    if !status.is_success() {
        return Err(api_error(status.as_u16(), &body));
    }
    serde_json::from_str(&body).with_context(|| "failed to parse API response".to_string())
}

impl Client {
    /// Build a client using base_url from the config or the default,
    /// and attaching the stored session token on every request.
    pub fn from_config(cfg: &Config) -> anyhow::Result<Self> {
        let base_url = Self::resolve_base_url(cfg.base_url.as_deref())?;
        if let Some(token) = &cfg.session_token {
            // Fail loudly instead of silently dropping the auth header.
            reqwest::header::HeaderValue::from_str(&format!("Bearer {token}"))
                .map_err(|_| ApiError::InvalidToken { len: token.len() })?;
        }
        Ok(Self::new(
            base_url.trim_end_matches('/'),
            cfg.session_token.clone(),
        ))
    }

    /// Resolve base URL with precedence: explicit config value (including
    /// the `--base-url` flag, which main.rs applies without persisting)
    /// > `WEBMARKS_BASE_URL` env var > default localhost.
    fn resolve_base_url(configured: Option<&str>) -> anyhow::Result<String> {
        if let Some(url) = configured {
            return Ok(url.to_string());
        }
        if let Ok(env_url) = std::env::var("WEBMARKS_BASE_URL") {
            if !env_url.is_empty() {
                return Ok(env_url);
            }
        }
        Ok("http://localhost:8787".into())
    }

    pub fn new(base_url: impl Into<String>, session_token: Option<String>) -> Self {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Some(token) = session_token {
            let value = reqwest::header::HeaderValue::from_str(&format!("Bearer {token}"))
                .map_err(|_| ApiError::InvalidToken { len: token.len() })
                .expect("session token must be a valid header value");
            headers.insert(reqwest::header::AUTHORIZATION, value);
        }
        let http = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .expect("reqwest client builds");
        Self {
            http,
            base_url: base_url.into(),
        }
    }

    /// The resolved API base URL (used by the browser login flow).
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    async fn send_json(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<&serde_json::Value>,
    ) -> anyhow::Result<reqwest::Response> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.http.request(method, &url);
        if let Some(json) = body {
            req = req.json(json);
        }
        let resp = req
            .send()
            .await
            .context("request to API failed — is the server running?")?;
        Ok(resp)
    }

    // --- Auth ---

    /// POST /api/auth/sign-out (requires content-type json + {} body or 415).
    pub async fn sign_out(&self) -> anyhow::Result<()> {
        let resp = self
            .send_json(
                reqwest::Method::POST,
                "/api/auth/sign-out",
                Some(&serde_json::json!({})),
            )
            .await?;
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(api_error(status, &body));
        }
        Ok(())
    }

    /// GET /api/me → user email + id.
    pub async fn whoami(&self) -> anyhow::Result<(String, String)> {
        #[derive(serde::Deserialize)]
        struct User {
            id: String,
            email: String,
        }
        #[derive(serde::Deserialize)]
        struct Me {
            user: User,
        }
        let me: Me = decode(
            self.send_json(reqwest::Method::GET, "/api/me", None)
                .await?,
        )
        .await?;
        Ok((me.user.id, me.user.email))
    }

    // --- Bookmarks ---

    pub async fn create_bookmark(
        &self,
        url: &str,
        visibility: Option<Visibility>,
    ) -> anyhow::Result<Bookmark> {
        let mut body = serde_json::json!({ "url": url });
        if let Some(v) = visibility {
            body["visibility"] = serde_json::to_value(v)?;
        }
        decode(
            self.send_json(reqwest::Method::POST, "/api/bookmarks", Some(&body))
                .await?,
        )
        .await
    }

    pub async fn list_bookmarks(&self, opts: ListOpts) -> anyhow::Result<BookmarkListResponse> {
        use reqwest::Method;
        let mut req = self
            .http
            .request(Method::GET, format!("{}/api/bookmarks", self.base_url));
        if let Some(limit) = opts.limit {
            req = req.query(&[("limit", limit.to_string())]);
        }
        if let Some(offset) = opts.offset {
            req = req.query(&[("offset", offset.to_string())]);
        }
        if let Some(q) = &opts.q {
            req = req.query(&[("q", q)]);
        }
        if let Some(tag) = &opts.tag {
            req = req.query(&[("tag", tag)]);
        }
        if let Some(status) = opts.fetch_status {
            req = req.query(&[("fetchStatus", status.as_str())]);
        }
        if let Some(vis) = opts.visibility {
            req = req.query(&[("visibility", vis.as_str())]);
        }
        if let Some(sort) = &opts.sort {
            req = req.query(&[("sort", sort)]);
        }
        let resp = req.send().await?;
        decode(resp).await
    }

    pub async fn get_bookmark(&self, id: &str) -> anyhow::Result<Bookmark> {
        decode(
            self.send_json(reqwest::Method::GET, &format!("/api/bookmarks/{id}"), None)
                .await?,
        )
        .await
    }

    pub async fn update_bookmark(&self, id: &str, opts: UpdateOpts) -> anyhow::Result<Bookmark> {
        let mut body = serde_json::Map::new();
        if let Some(t) = opts.title {
            body.insert("title".into(), t.into());
        }
        if let Some(d) = opts.description {
            body.insert("description".into(), d.into());
        }
        if let Some(v) = opts.visibility {
            body.insert("visibility".into(), serde_json::to_value(v)?);
        }
        decode(
            self.send_json(
                reqwest::Method::PATCH,
                &format!("/api/bookmarks/{id}"),
                Some(&serde_json::Value::Object(body)),
            )
            .await?,
        )
        .await
    }

    pub async fn delete_bookmark(&self, id: &str) -> anyhow::Result<bool> {
        #[derive(serde::Deserialize)]
        struct DelResp {
            ok: bool,
        }
        let r: DelResp = decode(
            self.send_json(
                reqwest::Method::DELETE,
                &format!("/api/bookmarks/{id}"),
                None,
            )
            .await?,
        )
        .await?;
        Ok(r.ok)
    }

    // --- Tags ---

    pub async fn set_tags(&self, bookmark_id: &str, tags: Vec<String>) -> anyhow::Result<Vec<Tag>> {
        #[derive(serde::Deserialize)]
        struct TagsResp {
            tags: Vec<Tag>,
        }
        let r: TagsResp = decode(
            self.send_json(
                reqwest::Method::PUT,
                &format!("/api/bookmarks/{bookmark_id}/tags"),
                Some(&serde_json::json!({ "tags": tags })),
            )
            .await?,
        )
        .await?;
        Ok(r.tags)
    }

    pub async fn list_tags_for(&self, bookmark_id: &str) -> anyhow::Result<Vec<Tag>> {
        #[derive(serde::Deserialize)]
        struct TagsResp {
            tags: Vec<Tag>,
        }
        let r: TagsResp = decode(
            self.send_json(
                reqwest::Method::GET,
                &format!("/api/bookmarks/{bookmark_id}/tags"),
                None,
            )
            .await?,
        )
        .await?;
        Ok(r.tags)
    }

    pub async fn list_tags(&self) -> anyhow::Result<Vec<(Tag, i64)>> {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct TagWithCount {
            id: String,
            name: String,
            bookmark_count: i64,
        }
        #[derive(serde::Deserialize)]
        struct TagsResp {
            tags: Vec<TagWithCount>,
        }
        let r: TagsResp = decode(
            self.send_json(reqwest::Method::GET, "/api/tags", None)
                .await?,
        )
        .await?;
        Ok(r.tags
            .into_iter()
            .map(|t| {
                (
                    Tag {
                        id: t.id,
                        name: t.name,
                    },
                    t.bookmark_count,
                )
            })
            .collect())
    }
}
