mod api;
mod cli;
mod config;
mod output;

use clap::Parser;

use crate::cli::{Cli, Commands};

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    let code = run(cli).await;
    std::process::exit(code);
}

async fn run(cli: Cli) -> i32 {
    match dispatch(cli).await {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("error: {e:#}");
            exit_code_for(&e)
        }
    }
}

fn exit_code_for(err: &anyhow::Error) -> i32 {
    for cause in err.chain() {
        if cause.to_string().contains("Unauthorized (401)") {
            return 3;
        }
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
    let (email, password_flag) = match &cli.command {
        Commands::Login { email, password } => (email.clone(), password.clone()),
        _ => unreachable!(),
    };
    let mut cfg = config::Config::load()?;
    if let Some(base) = &cli.base_url {
        cfg.base_url = Some(base.clone());
    }
    let client = api::Client::from_config(&cfg)?;
    let password = match password_flag {
        Some(p) => p,
        None => rpassword::prompt_password("Password: ")?,
    };
    client.sign_in(&email, &password).await?;
    println!("Logged in as {email}");
    Ok(())
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
    Ok(())
}

async fn cmd_list(cli: &Cli, cfg: &config::Config, opts: api::ListOpts) -> anyhow::Result<()> {
    let c = client(cli, cfg)?;
    let resp = c.list_bookmarks(opts).await?;
    if cli.json {
        println!("{}", serde_json::to_string(&resp).expect("list serializes"));
    } else {
        println!("{}", output::format_bookmark_table(&resp));
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
    c.delete_bookmark(id).await?;
    if !cli.json {
        println!("Deleted {id}");
    } else {
        println!("{}", serde_json::json!({ "ok": true }));
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
