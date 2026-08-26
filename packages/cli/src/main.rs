mod api;
mod cli;
mod config;
mod output;

use std::io::IsTerminal;

use clap::Parser;

use crate::cli::{Cli, Commands};

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    let code = run(cli).await;
    std::process::exit(code);
}

async fn run(cli: Cli) -> i32 {
    // Record --json once so error reporting can emit a structured envelope.
    JSON_MODE.store(cli.json, std::sync::atomic::Ordering::Relaxed);
    match dispatch(cli).await {
        Ok(()) => 0,
        Err(e) => {
            report_error(&e);
            exit_code_for(&e)
        }
    }
}

static JSON_MODE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn report_error(err: &anyhow::Error) {
    if JSON_MODE.load(std::sync::atomic::Ordering::Relaxed) {
        // Structured envelope on stderr so machines can branch on `code`
        // and read `fix`; stdout stays reserved for data.
        let envelope = serde_json::json!({
            "status": "error",
            "error": {
                "code": error_code_for(err),
                "message": format!("{err:#}"),
                "fix": fix_hint_for(err),
                "transient": is_transient(err),
            }
        });
        eprintln!("{envelope}");
        return;
    }

    eprintln!("error: {err:#}");
    if let Some(fix) = fix_hint_for(err) {
        eprintln!("\ntry: {fix}");
    }
}

/// Machine-readable error class for agents to branch on.
fn error_code_for(err: &anyhow::Error) -> &'static str {
    if err.chain().any(|c| c.is::<api::ApiError>()) {
        match err
            .chain()
            .find_map(|c| c.downcast_ref::<api::ApiError>())
            .and_then(api::ApiError::status)
        {
            Some(401) => "AUTH_REQUIRED",
            Some(404) => "NOT_FOUND",
            Some(_) => "API_ERROR",
            None => "API_ERROR",
        }
    } else if err.chain().any(|c| {
        c.downcast_ref::<reqwest::Error>()
            .is_some_and(|r| r.is_connect() || r.is_timeout())
    }) {
        "NETWORK"
    } else {
        "UNKNOWN"
    }
}

/// The exact command a user (or agent) can run to recover.
fn fix_hint_for(err: &anyhow::Error) -> Option<String> {
    if err.chain().any(|c| c.is::<api::ApiError>()) {
        let status = err
            .chain()
            .find_map(|c| c.downcast_ref::<api::ApiError>())
            .and_then(api::ApiError::status);
        return match status {
            Some(401) => Some("webmarks login --email <you@example.com>".to_string()),
            Some(_) => None,
            None => None,
        };
    }
    for cause in err.chain() {
        if let Some(reqwest_err) = cause.downcast_ref::<reqwest::Error>() {
            if reqwest_err.is_connect() || reqwest_err.is_timeout() {
                return Some(
                    "check the server is running, or pass --base-url <url>".to_string(),
                );
            }
            return None;
        }
    }
    None
}

/// Whether retrying may plausibly succeed.
fn is_transient(err: &anyhow::Error) -> bool {
    err.chain().any(|cause| {
        cause
            .downcast_ref::<reqwest::Error>()
            .is_some_and(|r| r.is_connect() || r.is_timeout())
    })
}

fn exit_code_for(err: &anyhow::Error) -> i32 {
    if err.chain().any(|cause| cause.is::<api::ApiError>()) {
        // Typed API errors carry explicit statuses.
        let status = err
            .chain()
            .find_map(|cause| cause.downcast_ref::<api::ApiError>())
            .and_then(api::ApiError::status);
        return match status {
            Some(401) => 3,
            Some(404) => 2,
            Some(_) => 1,
            None => 1,
        };
    }
    for cause in err.chain() {
        if let Some(reqwest_err) = cause.downcast_ref::<reqwest::Error>() {
            if reqwest_err.is_connect() || reqwest_err.is_timeout() {
                return 4;
            }
            return 1;
        }
    }
    1
}

async fn dispatch(cli: Cli) -> anyhow::Result<()> {
    // Commands that do not need a pre-built client.
    if let Commands::Login { .. } = &cli.command {
        return cmd_login(&cli).await;
    }

    let mut cfg = config::Config::load()?;
    if let Some(base) = &cli.base_url {
        cfg.base_url = Some(base.clone());
    }

    match &cli.command {
        Commands::Logout => cmd_logout(&cli, cfg).await,
        Commands::Whoami => cmd_whoami(&cli, &cfg).await,
        Commands::Add { url, visibility } => cmd_add(&cli, &cfg, url, *visibility).await,
        Commands::List {
            limit,
            offset,
            query,
            tag,
            status,
            visibility,
            sort,
        } => {
            cmd_list(
                &cli,
                &cfg,
                api::ListOpts {
                    limit: Some(*limit),
                    offset: Some(*offset),
                    q: query.clone(),
                    tag: tag.clone(),
                    fetch_status: *status,
                    visibility: visibility.map(Into::into),
                    sort: sort.map(|s| s.as_str().to_string()),
                },
            )
            .await
        }
        Commands::Get { id } => cmd_get(&cli, &cfg, id).await,
        Commands::Update {
            id,
            title,
            description,
            visibility,
        } => {
            cmd_update(
                &cli,
                &cfg,
                id,
                title.clone(),
                description.clone(),
                *visibility,
            )
            .await
        }
        Commands::Rm { id } => cmd_rm(&cli, &cfg, id).await,
        Commands::Tag { command } => cmd_tag(&cli, &cfg, command).await,
        Commands::Tags => cmd_tags(&cli, &cfg).await,
        Commands::Login { .. } => unreachable!("handled above"),
    }
}

// --- Command handlers ---

fn client(_cli: &Cli, cfg: &config::Config) -> anyhow::Result<api::Client> {
    api::Client::from_config(cfg)
}

fn print_bookmark_or_json(cli: &Cli, bookmark: &config::Bookmark) {
    if cli.json {
        println!(
            "{}",
            serde_json::to_string(bookmark).expect("bookmark serializes")
        );
    } else {
        println!("{}", output::format_bookmark(bookmark));
    }
}

async fn cmd_login(cli: &Cli) -> anyhow::Result<()> {
    let (email, password_flag, password_file) = match &cli.command {
        Commands::Login {
            email,
            password,
            password_file,
        } => (email.clone(), password.clone(), password_file.clone()),
        _ => unreachable!(),
    };
    let mut cfg = config::Config::load()?;
    // Apply --base-url for this invocation only; don't persist a one-off flag.
    if let Some(base) = &cli.base_url {
        cfg.base_url = Some(base.clone());
    }
    let client = api::Client::from_config(&cfg)?;
    let password = match (&password_file, &password_flag, password_from_env()) {
        // Highest precedence first: explicit file > env var > flag > TTY prompt.
        (Some(path), _, _) => std::fs::read_to_string(path)
            .map_err(anyhow::Error::from)?
            .trim_end_matches(['\n', '\r'])
            .to_string(),
        (None, _, Some(p)) if !p.is_empty() => p,
        (None, Some(p), _) => p.clone(),
        _ => {
            // Interactive prompt only makes sense when stdin/stdout are a terminal;
            // in CI or scripts fail with an actionable message instead of hanging.
            if !std::io::stdin().is_terminal() || !std::io::stderr().is_terminal() {
                anyhow::bail!(
                    "no password provided and stdin is not a terminal; \
                     use --password-file <FILE> or set WEBMARKS_PASSWORD"
                );
            }
            rpassword::prompt_password("Password: ")?
        }
    };
    client.sign_in(&email, &password).await?;
    println!("Logged in as {email}");
    Ok(())
}

fn password_from_env() -> Option<String> {
    std::env::var("WEBMARKS_PASSWORD")
        .ok()
        .filter(|v| !v.is_empty())
}

async fn cmd_logout(_cli: &Cli, mut cfg: config::Config) -> anyhow::Result<()> {
    if cfg.session_token.is_some() {
        // Best-effort server-side revocation; token removal happens regardless.
        let c = api::Client::from_config(&cfg)?;
        if let Err(e) = c.sign_out().await {
            eprintln!("warning: server sign-out failed ({e}); removing local token anyway");
        }
    }
    cfg.session_token = None;
    cfg.save()?;
    println!("Logged out");
    Ok(())
}

async fn cmd_whoami(cli: &Cli, cfg: &config::Config) -> anyhow::Result<()> {
    let c = client(cli, cfg)?;
    let (_id, email) = c.whoami().await?;
    if cli.json {
        println!("{}", serde_json::json!({ "email": email }));
    } else {
        println!("{email}");
    }
    Ok(())
}

async fn cmd_add(
    cli: &Cli,
    cfg: &config::Config,
    url: &str,
    visibility: Option<cli::VisibilityArg>,
) -> anyhow::Result<()> {
    let c = client(cli, cfg)?;
    let bm = c.create_bookmark(url, visibility.map(Into::into)).await?;
    print_bookmark_or_json(cli, &bm);
    if !cli.json {
        println!(
            "\nnext: webmarks get {} — or open {}",
            bm.id.get(..8.min(bm.id.len())).unwrap_or(&bm.id),
            bm.url
        );
    }
    Ok(())
}

async fn cmd_list(cli: &Cli, cfg: &config::Config, opts: api::ListOpts) -> anyhow::Result<()> {
    let c = client(cli, cfg)?;
    let resp = c.list_bookmarks(opts).await?;
    if cli.json {
        println!("{}", serde_json::to_string(&resp).expect("list serializes"));
    } else {
        println!("{}", output::format_bookmark_table(&resp));
        // Tell the reader how to get more instead of leaving them guessing.
        let shown = resp.bookmarks.len() as i64;
        let remaining = resp.total - resp.offset - shown;
        if remaining > 0 {
            let next_offset = resp.offset + shown;
            println!(
                "\nnext page: webmarks list --offset {next_offset} ({} of {} shown)",
                resp.offset + shown,
                resp.total
            );
        }
    }
    Ok(())
}

async fn cmd_get(cli: &Cli, cfg: &config::Config, id: &str) -> anyhow::Result<()> {
    let c = client(cli, cfg)?;
    let bm = c.get_bookmark(id).await?;
    print_bookmark_or_json(cli, &bm);
    Ok(())
}

async fn cmd_update(
    cli: &Cli,
    cfg: &config::Config,
    id: &str,
    title: Option<String>,
    description: Option<String>,
    visibility: Option<cli::VisibilityArg>,
) -> anyhow::Result<()> {
    let c = client(cli, cfg)?;
    let bm = c
        .update_bookmark(
            id,
            api::UpdateOpts {
                title,
                description,
                visibility: visibility.map(Into::into),
            },
        )
        .await?;
    print_bookmark_or_json(cli, &bm);
    Ok(())
}

async fn cmd_rm(cli: &Cli, cfg: &config::Config, id: &str) -> anyhow::Result<()> {
    let c = client(cli, cfg)?;
    let ok = c.delete_bookmark(id).await?;
    if !ok {
        anyhow::bail!("server reported delete of {id} as not ok");
    }
    if cli.json {
        println!("{}", serde_json::json!({ "ok": true }));
    } else {
        println!("Deleted {id}");
    }
    Ok(())
}

async fn cmd_tag(
    cli: &Cli,
    cfg: &config::Config,
    command: &cli::TagCommands,
) -> anyhow::Result<()> {
    let c = client(cli, cfg)?;
    match command {
        cli::TagCommands::Set { bookmark_id, tags } => {
            let tags = c.set_tags(bookmark_id, tags.clone()).await?;
            if cli.json {
                println!(
                    "{}",
                    serde_json::to_string(&serde_json::json!({ "tags": tags }))?
                );
            } else {
                println!("{}", output::join_names(&tags));
            }
        }
        cli::TagCommands::Ls { bookmark_id } => {
            let tags = c.list_tags_for(bookmark_id).await?;
            if cli.json {
                println!(
                    "{}",
                    serde_json::to_string(&serde_json::json!({ "tags": tags }))?
                );
            } else {
                println!("{}", output::join_names_or_none(&tags));
            }
        }
    }
    Ok(())
}

async fn cmd_tags(cli: &Cli, cfg: &config::Config) -> anyhow::Result<()> {
    let c = client(cli, cfg)?;
    let rows = c.list_tags().await?;
    if cli.json {
        let json: Vec<serde_json::Value> = rows
            .iter()
            .map(|(t, count)| serde_json::json!({ "id": t.id, "name": t.name, "bookmarkCount": count }))
            .collect();
        println!("{}", serde_json::to_string(&json)?);
    } else if rows.is_empty() {
        println!("(no tags)");
    } else {
        println!("{:<20} BOOKMARKS", "TAG");
        for (tag, count) in rows {
            println!("{:<20} {}", tag.name, count);
        }
    }
    Ok(())
}
