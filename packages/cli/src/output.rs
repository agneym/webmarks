use crate::config::{Bookmark, BookmarkListResponse, Tag};

/// One-line human summary of a bookmark.
pub fn format_bookmark(b: &Bookmark) -> String {
    let id = &b.id[..8.min(b.id.len())];
    let title = b.title.clone().unwrap_or_else(|| b.url.clone());
    let status = b
        .fetch_status
        .map(|s| match s {
            crate::config::FetchStatus::Pending => "pending",
            crate::config::FetchStatus::Success => "success",
            crate::config::FetchStatus::Failed => "failed",
        })
        .unwrap_or("-");
    let tags = join_names_or_none(&b.tags);
    format!(
        "{id}  {:<30} [{status}] {} ({})",
        title,
        tags,
        b.visibility.as_str()
    )
}

impl VisibilityExt for crate::config::Visibility {
    fn as_str(&self) -> &'static str {
        match self {
            crate::config::Visibility::Public => "public",
            crate::config::Visibility::Private => "private",
        }
    }
}

pub trait VisibilityExt {
    fn as_str(&self) -> &'static str;
}

/// Table render of a bookmark list response.
pub fn format_bookmark_table(resp: &BookmarkListResponse) -> String {
    if resp.bookmarks.is_empty() {
        return "(no bookmarks)".to_string();
    }
    let mut lines = Vec::new();
    for b in &resp.bookmarks {
        lines.push(format_bookmark(b));
    }
    lines.push(String::new());
    lines.push(format!(
        "{} bookmark(s) (total {}, showing offset {})",
        resp.bookmarks.len(),
        resp.total,
        resp.offset
    ));
    lines.join("\n")
}

pub fn join_names(tags: &[Tag]) -> String {
    tags.iter()
        .map(|t| t.name.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

pub fn join_names_or_none(tags: &[Tag]) -> String {
    if tags.is_empty() {
        "(no tags)".to_string()
    } else {
        join_names(tags)
    }
}
