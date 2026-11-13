use matchmaking::engine::PartnerRequest;
use matchmaking::server::{ServerConfig, run};

fn env_u64(name: &str, default: u64) -> u64 {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let mut cfg = ServerConfig::default();
    cfg.tick_ms = env_u64("TICK_MS", cfg.tick_ms);
    cfg.heartbeat_timeout_ms = env_u64("HEARTBEAT_TIMEOUT_MS", cfg.heartbeat_timeout_ms);
    cfg.engine.wait_budget_ms = env_u64("WAIT_BUDGET_MS", cfg.engine.wait_budget_ms);
    cfg.engine.offer_window_ms = env_u64("OFFER_WINDOW_MS", cfg.engine.offer_window_ms);
    cfg.engine.recent_partner_cooldown_ms = env_u64("RECENT_PARTNER_COOLDOWN_MS", cfg.engine.recent_partner_cooldown_ms);
    cfg.engine.decline_cooldown_ms = env_u64("DECLINE_COOLDOWN_MS", cfg.engine.decline_cooldown_ms);

    // Partner requests are loaded from a file; without one, a small built-in list is used.
    let path = std::env::var("PARTNER_REQUESTS").unwrap_or_else(|_| "partner_requests.json".to_string());
    match std::fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<Vec<PartnerRequest>>(&text) {
            Ok(list) => cfg.partner_requests = list,
            Err(e) => {
                eprintln!("could not parse {path}: {e}");
                std::process::exit(1);
            }
        },
        Err(_) => eprintln!("no {path}; using the built-in partner requests"),
    }

    let port: u16 = match std::env::var("PORT") {
        Err(_) => 8080,
        Ok(v) => v.parse().unwrap_or_else(|_| {
            eprintln!("PORT must be a number from 0 to 65535, got {v:?}");
            std::process::exit(1);
        }),
    };
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    println!("matchmaking server on http://0.0.0.0:{port}  (WebSocket: /ws?user_id=...)");
    println!(
        "tick {} ms · offer window {} ms · wait budget {} ms · {} partner request(s)",
        cfg.tick_ms,
        cfg.engine.offer_window_ms,
        cfg.engine.wait_budget_ms,
        cfg.partner_requests.len()
    );
    run(listener, cfg).await
}
