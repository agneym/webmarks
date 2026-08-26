use std::fmt;

use clap::{Parser, Subcommand, ValueEnum};

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum SortOrder {
    Newest,
    Oldest,
    Title,
    TitleDesc,
    Updated,
}

impl SortOrder {
    pub fn as_str(&self) -> &'static str {
        match self {
            SortOrder::Newest => "newest",
            SortOrder::Oldest => "oldest",
            SortOrder::Title => "title",
            SortOrder::TitleDesc => "title_desc",
            SortOrder::Updated => "updated",
        }
    }
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum VisibilityArg {
    Public,
    Private,
}

impl From<VisibilityArg> for crate::config::Visibility {
    fn from(v: VisibilityArg) -> Self {
        match v {
            VisibilityArg::Public => crate::config::Visibility::Public,
            VisibilityArg::Private => crate::config::Visibility::Private,
        }
    }
}

/// Implement Display so backend errors like "visibility must be public|private" read naturally.
impl fmt::Display for VisibilityArg {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl VisibilityArg {
    pub fn as_str(&self) -> &'static str {
        match self {
            VisibilityArg::Public => "public",
            VisibilityArg::Private => "private",
        }
    }
}

#[derive(Parser)]
#[command(
    name = "webmarks",
    version,
    about = "CLI for the webmarks bookmarking API",
    after_help = "Exit codes: 0 success, 1 API error, 2 not found, 3 auth required, 4 network"
)]
pub struct Cli {
    /// Base URL of the webmarks API
    #[arg(long, global = true)]
    pub base_url: Option<String>,

    /// Output raw JSON instead of human-readable text
    #[arg(long, global = true)]
    pub json: bool,

    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Sign in and store a session token locally
    Login {
        #[arg(long)]
        email: String,
        #[arg(long)]
        password: Option<String>,
    },
    /// Sign out and remove the stored token
    Logout,
    /// Show the currently signed-in user
    Whoami,
    /// Add a bookmark
    Add {
        url: String,
        #[arg(long, value_enum)]
        visibility: Option<VisibilityArg>,
    },
    /// List bookmarks
    List {
        #[arg(long, default_value_t = 50)]
        limit: u32,
        #[arg(long, default_value_t = 0)]
        offset: u32,
        /// Search query (matches title, description, url)
        #[arg(short = 'q', long)]
        query: Option<String>,
        /// Filter by tag name
        #[arg(long)]
        tag: Option<String>,
        /// Filter by metadata fetch status
        #[arg(long, value_enum)]
        status: Option<crate::config::FetchStatus>,
        /// Filter by visibility
        #[arg(long, value_enum)]
        visibility: Option<VisibilityArg>,
        /// Sort order
        #[arg(long, value_enum)]
        sort: Option<SortOrder>,
    },
    /// Get one bookmark by id
    Get { id: String },
    /// Update a bookmark
    Update {
        id: String,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long, value_enum)]
        visibility: Option<VisibilityArg>,
    },
    /// Delete a bookmark
    Rm { id: String },
    /// Tag subcommands
    Tag {
        #[command(subcommand)]
        command: TagCommands,
    },
    /// List all tags with bookmark counts
    Tags,
}

#[derive(Subcommand)]
pub enum TagCommands {
    /// Replace all tags on a bookmark
    Set {
        bookmark_id: String,
        tags: Vec<String>,
    },
    /// List tags on a bookmark
    Ls { bookmark_id: String },
}
