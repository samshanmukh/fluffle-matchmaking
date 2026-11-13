//! The network layer: one WebSocket per user, one engine behind one lock.
//!
//! Every engine call happens while holding the lock and nothing awaits while
//! it is held, so engine transitions are atomic no matter how many sockets
//! talk at once. Each connection has its own outbound queue, so a slow phone
//! never blocks the engine.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::{Notify, mpsc};

use crate::engine::{Answer, Config, Engine, Event, MatchId, Ms, PartnerRequest};

#[derive(Clone, Debug)]
pub struct ServerConfig {
    /// How often the pairing pass runs.
    pub tick_ms: u64,
    /// A connection that sends nothing for this long is treated as gone.
    pub heartbeat_timeout_ms: u64,
    pub engine: Config,
    pub partner_requests: Vec<PartnerRequest>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self { tick_ms: 1000, heartbeat_timeout_ms: 30_000, engine: Config::default(), partner_requests: default_partner_requests() }
    }
}

pub fn default_partner_requests() -> Vec<PartnerRequest> {
    vec![
        PartnerRequest { languages: vec!["english".into(), "spanish".into()], topic: None },
        PartnerRequest { languages: vec!["english".into()], topic: Some("politics".into()) },
        PartnerRequest { languages: vec!["hindi".into()], topic: None },
    ]
}

/// Messages a connection may have queued before it is judged too slow.
/// A user receives a handful of messages a minute, so this is generous.
const OUTBOUND_QUEUE: usize = 256;

struct Conn {
    id: u64,
    tx: mpsc::Sender<String>,
    /// Tells the connection's task to close (queue overflow, or replaced).
    kick: Arc<Notify>,
}

pub struct Hub {
    engine: Engine,
    conns: HashMap<String, Conn>,
    names: HashMap<String, String>,
    /// Where each person says they are connecting from: an ISO 3166-1 alpha-2
    /// code ("BR"), shown to their match as a flag. Absent when not given.
    regions: HashMap<String, String>,
    started: Instant,
    next_conn: u64,
}

impl Hub {
    fn now(&self) -> Ms {
        self.started.elapsed().as_millis() as Ms
    }

    fn send(&self, user: &str, msg: Value) {
        if let Some(conn) = self.conns.get(user) {
            // Never wait on a client while holding the engine lock. A client
            // that is not draining its queue is disconnected, which frees
            // its place exactly like any other dropped connection.
            if let Err(mpsc::error::TrySendError::Full(_)) = conn.tx.try_send(msg.to_string()) {
                conn.kick.notify_one();
            }
        }
    }

    fn dispatch(&self, events: Vec<Event>) {
        for event in events {
            let mut msg = serde_json::to_value(&event.kind).expect("events serialize");
            // Offers and calls carry the partner's id; add the display name and region.
            if let Some(partner) = msg.get("partner").and_then(Value::as_str) {
                let name = self.names.get(partner).cloned().unwrap_or_else(|| partner.to_string());
                let region = self.regions.get(partner).cloned().map_or(Value::Null, Value::String);
                msg["partner_name"] = Value::String(name);
                msg["partner_region"] = region;
            }
            self.send(&event.user, msg);
        }
    }
}

pub type Shared = Arc<Mutex<Hub>>;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMsg {
    Join {
        languages: Vec<String>,
        #[serde(default)]
        topic: Option<String>,
    },
    Leave,
    Respond {
        match_id: MatchId,
        answer: Answer,
        #[serde(default)]
        never_again: bool,
    },
    EndCall,
    Block {
        user_id: String,
    },
    Ping,
}

#[derive(Deserialize)]
struct ConnQuery {
    user_id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    region: Option<String>,
}

/// Accepts a two-letter country code in either case; anything else is treated as not given.
fn region_code(raw: Option<String>) -> Option<String> {
    let code = raw?.trim().to_ascii_uppercase();
    (code.len() == 2 && code.bytes().all(|b| b.is_ascii_uppercase())).then_some(code)
}

#[derive(Deserialize)]
struct EstimateQuery {
    /// Comma-separated.
    languages: String,
}

pub fn build(cfg: &ServerConfig) -> (Router, Shared) {
    let shared: Shared = Arc::new(Mutex::new(Hub {
        engine: Engine::new(cfg.engine.clone(), &cfg.partner_requests),
        conns: HashMap::new(),
        names: HashMap::new(),
        regions: HashMap::new(),
        started: Instant::now(),
        next_conn: 0,
    }));
    let heartbeat = Duration::from_millis(cfg.heartbeat_timeout_ms);
    let router = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/estimate", get(estimate))
        .route("/presence", get(presence))
        .route("/stats", get(stats))
        .route(
            "/ws",
            get(move |State(shared): State<Shared>, Query(q): Query<ConnQuery>, ws: WebSocketUpgrade| async move {
                ws.on_upgrade(move |socket| client(socket, shared, q, heartbeat))
            }),
        )
        .with_state(shared.clone());
    (router, shared)
}

/// Runs the server until the listener fails. The pairing pass runs on its own task.
pub async fn run(listener: tokio::net::TcpListener, cfg: ServerConfig) -> std::io::Result<()> {
    let (router, shared) = build(&cfg);
    let tick = tokio::spawn(tick_loop(shared, cfg.tick_ms));
    let result = axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>()).await;
    tick.abort();
    result
}

/// Starts a server on a free local port. Used by tests and the load tester.
pub async fn spawn_local(cfg: ServerConfig) -> std::io::Result<(SocketAddr, tokio::task::JoinHandle<std::io::Result<()>>)> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    Ok((addr, tokio::spawn(run(listener, cfg))))
}

async fn tick_loop(shared: Shared, tick_ms: u64) {
    let mut interval = tokio::time::interval(Duration::from_millis(tick_ms.max(1)));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        interval.tick().await;
        let mut hub = shared.lock().unwrap();
        let now = hub.now();
        let events = hub.engine.tick(now);
        hub.dispatch(events);
    }
}

async fn estimate(State(shared): State<Shared>, Query(q): Query<EstimateQuery>) -> impl IntoResponse {
    let languages: Vec<String> = q.languages.split(',').map(str::to_string).collect();
    let hub = shared.lock().unwrap();
    Json(hub.engine.estimate(&languages, hub.now()))
}

/// How many people the "who's here" display describes individually.
const PRESENCE_LIMIT: usize = 12;

/// A number the app turns into an avatar. Derived from the user id (FNV-1a, the
/// same function the app uses), so a person looks the same in this list and
/// in an offer, without their id ever being listed here.
fn avatar_code(user: &str) -> u32 {
    user.bytes().fold(2_166_136_261, |h, b| (h ^ u32::from(b)).wrapping_mul(16_777_619))
}

/// Who is waiting right now and shares a language: a count, and for the first
/// few an avatar code and region. No names and no ids.
async fn presence(State(shared): State<Shared>, Query(q): Query<EstimateQuery>) -> impl IntoResponse {
    let languages: Vec<String> = q.languages.split(',').map(str::to_string).collect();
    let hub = shared.lock().unwrap();
    let users = hub.engine.waiting_sharing(&languages);
    let people: Vec<Value> = users
        .iter()
        .take(PRESENCE_LIMIT)
        .map(|user| json!({ "avatar": avatar_code(user), "region": hub.regions.get(user) }))
        .collect();
    Json(json!({ "waiting": users.len(), "people": people }))
}

async fn stats(State(shared): State<Shared>) -> impl IntoResponse {
    let hub = shared.lock().unwrap();
    Json(json!({ "engine": hub.engine.stats(), "connections": hub.conns.len() }))
}

async fn client(socket: WebSocket, shared: Shared, q: ConnQuery, heartbeat: Duration) {
    let user = q.user_id;
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::channel::<String>(OUTBOUND_QUEUE);
    let kick = Arc::new(Notify::new());

    let conn_id = {
        let mut hub = shared.lock().unwrap();
        let id = hub.next_conn;
        hub.next_conn += 1;
        // A second connection for the same user replaces the first: a user
        // holds one place, whichever device they are on.
        if let Some(old) = hub.conns.insert(user.clone(), Conn { id, tx, kick: kick.clone() }) {
            let _ = old.tx.try_send(json!({ "type": "replaced" }).to_string());
        }
        hub.names.insert(user.clone(), q.name.unwrap_or_else(|| user.clone()));
        match region_code(q.region) {
            Some(code) => hub.regions.insert(user.clone(), code),
            None => hub.regions.remove(&user),
        };
        let cfg = hub.engine.config();
        let hello = json!({
            "type": "hello",
            "user_id": user,
            "state": hub.engine.phase(&user),
            "offer_window_ms": cfg.offer_window_ms,
            "wait_budget_ms": cfg.wait_budget_ms,
        });
        hub.send(&user, hello);
        id
    };

    let writer = tokio::spawn(async move {
        while let Some(text) = rx.recv().await {
            if sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    loop {
        // No message at all within the heartbeat window means the phone is
        // gone (apps ping every few seconds), so stop offering them matches.
        let frame = tokio::select! {
            _ = kick.notified() => break,
            frame = tokio::time::timeout(heartbeat, stream.next()) => frame,
        };
        let frame = match frame {
            Err(_) | Ok(None) | Ok(Some(Err(_))) => break,
            Ok(Some(Ok(frame))) => frame,
        };
        let text = match frame {
            Message::Text(t) => t,
            Message::Close(_) => break,
            _ => continue,
        };
        let mut hub = shared.lock().unwrap();
        if hub.conns.get(&user).map(|c| c.id) != Some(conn_id) {
            break; // replaced by a newer connection
        }
        match serde_json::from_str::<ClientMsg>(text.as_str()) {
            Ok(msg) => handle(&mut hub, &user, msg),
            Err(e) => hub.send(&user, json!({ "type": "error", "code": "bad_message", "message": e.to_string() })),
        }
    }

    {
        let mut hub = shared.lock().unwrap();
        if hub.conns.get(&user).map(|c| c.id) == Some(conn_id) {
            hub.conns.remove(&user);
            let now = hub.now();
            let events = hub.engine.leave(&user, now);
            hub.dispatch(events);
        }
    }
    writer.abort();
}

fn handle(hub: &mut Hub, user: &str, msg: ClientMsg) {
    let now = hub.now();
    let fail = |hub: &Hub, e: crate::engine::EngineError| {
        let mut body = serde_json::to_value(&e).expect("errors serialize");
        body["type"] = Value::String("error".into());
        body["message"] = Value::String(e.to_string());
        hub.send(user, body);
    };
    match msg {
        ClientMsg::Join { languages, topic } => match hub.engine.join(user, &languages, topic.as_deref(), now) {
            Ok(estimate) => {
                let budget = hub.engine.config().wait_budget_ms;
                hub.send(user, json!({ "type": "joined", "estimate": estimate, "wait_budget_ms": budget }));
            }
            Err(e) => fail(hub, e),
        },
        ClientMsg::Leave => {
            let events = hub.engine.leave(user, now);
            hub.dispatch(events);
        }
        ClientMsg::Respond { match_id, answer, never_again } => match hub.engine.respond(user, match_id, answer, never_again, now) {
            Ok(events) => hub.dispatch(events),
            Err(e) => fail(hub, e),
        },
        ClientMsg::EndCall => match hub.engine.end_call(user, now) {
            Ok(events) => hub.dispatch(events),
            Err(e) => fail(hub, e),
        },
        ClientMsg::Block { user_id } => match hub.engine.block(user, &user_id, now) {
            Ok(events) => {
                hub.send(user, json!({ "type": "blocked", "user_id": user_id }));
                hub.dispatch(events);
            }
            Err(e) => fail(hub, e),
        },
        ClientMsg::Ping => hub.send(user, json!({ "type": "pong" })),
    }
}
