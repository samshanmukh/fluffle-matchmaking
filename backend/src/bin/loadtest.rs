//! Load tests.
//!
//!   cargo run --release --bin loadtest -- engine  [--sizes 1000,10000,100000] [--naive-max 4000]
//!   cargo run --release --bin loadtest -- network [--users 2000] [--url ws://host:8080]
//!         [--tick-ms 250] [--ramp-ms 2000] [--latency-ms 0] [--jitter-ms 0]
//!         [--decline-rate 0.05] [--drop-rate 0.02] [--hold-ms 500] [--timeout-s 30]
//!
//! `engine` times one pairing pass over a large queue, with no network.
//! `network` connects many real WebSocket clients (to a server it starts
//! itself unless `--url` is given), plays each user through join -> offer ->
//! answer -> call, and checks nobody was double-matched along the way.
//! Latency, jitter, declines and dropped connections are simulated client-side.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use matchmaking::engine::{Config, Engine, EventKind};
use matchmaking::server::{ServerConfig, spawn_local};
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::Message;

// ------------------------------------------------------------------ helpers

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n.max(1)
    }
}

/// A rough world: a few big languages and a long tail of small ones.
const LANGUAGES: [(&str, u64); 12] = [
    ("english", 40),
    ("spanish", 15),
    ("hindi", 10),
    ("french", 8),
    ("portuguese", 6),
    ("arabic", 5),
    ("swahili", 4),
    ("german", 4),
    ("japanese", 3),
    ("yoruba", 2),
    ("korean", 2),
    ("tagalog", 1),
];
const TOPICS: [&str; 5] = ["sports", "politics", "music", "travel", "philosophy"];

fn pick_language(rng: &mut Rng) -> &'static str {
    let total: u64 = LANGUAGES.iter().map(|(_, w)| w).sum();
    let mut roll = rng.below(total);
    for (name, weight) in LANGUAGES {
        if roll < weight {
            return name;
        }
        roll -= weight;
    }
    LANGUAGES[0].0
}

fn random_profile(rng: &mut Rng) -> (Vec<String>, Option<String>) {
    let mut langs = vec![pick_language(rng).to_string()];
    if rng.unit() < 0.35 {
        langs.push(pick_language(rng).to_string());
    }
    if rng.unit() < 0.10 {
        langs.push(pick_language(rng).to_string());
    }
    let topic = (rng.unit() < 0.4).then(|| TOPICS[rng.below(TOPICS.len() as u64) as usize].to_string());
    (langs, topic)
}

struct Args(HashMap<String, String>);

impl Args {
    fn parse(raw: &[String]) -> Self {
        let mut map = HashMap::new();
        let mut i = 0;
        while i < raw.len() {
            if let Some(key) = raw[i].strip_prefix("--") {
                let value = raw.get(i + 1).cloned().unwrap_or_default();
                map.insert(key.to_string(), value);
                i += 2;
            } else {
                i += 1;
            }
        }
        Args(map)
    }
    fn num<T: std::str::FromStr>(&self, key: &str, default: T) -> T {
        self.0.get(key).and_then(|v| v.parse().ok()).unwrap_or(default)
    }
    fn text(&self, key: &str) -> Option<&str> {
        self.0.get(key).map(String::as_str)
    }
}

fn percentile(sorted: &[u128], p: f64) -> u128 {
    if sorted.is_empty() {
        return 0;
    }
    let idx = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[idx]
}

// ------------------------------------------------------------------ engine

fn filled_engine(n: usize, reference: bool) -> Engine {
    let mut engine = Engine::new(Config::default(), &matchmaking::server::default_partner_requests());
    engine.use_reference_selection = reference;
    let mut rng = Rng::new(42);
    for i in 0..n {
        let (langs, topic) = random_profile(&mut rng);
        engine.join(&format!("u{i}"), &langs, topic.as_deref(), i as u64).expect("joins");
    }
    engine
}

fn offers_in(events: &[matchmaking::engine::Event]) -> usize {
    events.iter().filter(|e| matches!(e.kind, EventKind::Offer { .. })).count() / 2
}

fn run_engine(args: &Args) {
    let sizes: Vec<usize> =
        args.text("sizes").unwrap_or("1000,5000,20000,50000,100000").split(',').filter_map(|s| s.trim().parse().ok()).collect();
    let naive_max: usize = args.num("naive-max", 5000);

    println!("One pairing pass over a full queue (everyone joined, nobody paired yet).");
    println!("Second pass = the people left over after the first, re-checked.\n");
    println!("{:>9}  {:>12}  {:>12}  {:>9}  {:>9}  {:>14}", "waiting", "first pass", "second pass", "pairs", "left over", "reference O(n²)");
    for n in sizes {
        let mut engine = filled_engine(n, false);
        let t = Instant::now();
        let events = engine.tick(n as u64 + 1);
        let first = t.elapsed();
        let pairs = offers_in(&events);
        let t = Instant::now();
        engine.tick(n as u64 + 2);
        let second = t.elapsed();
        engine.check_invariants().expect("invariants hold");

        let reference = if n <= naive_max {
            let mut slow = filled_engine(n, true);
            let t = Instant::now();
            let slow_pairs = offers_in(&slow.tick(n as u64 + 1));
            assert_eq!(slow_pairs, pairs, "indexed and reference disagree at n={n}");
            format!("{:.1} ms", t.elapsed().as_secs_f64() * 1000.0)
        } else {
            "skipped".to_string()
        };
        println!(
            "{:>9}  {:>9.1} ms  {:>9.1} ms  {:>9}  {:>9}  {:>14}",
            n,
            first.as_secs_f64() * 1000.0,
            second.as_secs_f64() * 1000.0,
            pairs,
            n - pairs * 2,
            reference
        );
    }
}

// ------------------------------------------------------------------ network

#[derive(Default, Clone)]
struct Outcome {
    connected: bool,
    error: Option<String>,
    offers: u32,
    requeues: u32,
    first_offer_ms: Option<u128>,
    call_ms: Option<u128>,
    call: Option<(u64, String)>,
    declined: bool,
    dropped: bool,
    left_reason: Option<String>,
    /// Answers that arrived after the partner had already declined or left.
    /// Expected under real network delay; the server rejects them harmlessly.
    stale_answers: u32,
    /// A second offer arrived while one was still open: must never happen.
    overlapping_offers: u32,
}

#[derive(Clone)]
struct NetParams {
    url: String,
    latency_ms: u64,
    jitter_ms: u64,
    decline_rate: f64,
    drop_rate: f64,
    hold_ms: u64,
    deadline: Instant,
}

async fn simulate_user(index: usize, start_after: Duration, p: NetParams) -> (String, Outcome) {
    let user = format!("load{index}");
    let mut out = Outcome::default();
    let mut rng = Rng::new(index as u64 + 1);
    tokio::time::sleep(start_after).await;

    let url = format!("{}/ws?user_id={user}", p.url);
    let mut ws = match tokio_tungstenite::connect_async(url).await {
        Ok((ws, _)) => ws,
        Err(e) => {
            out.error = Some(format!("connect: {e}"));
            return (user, out);
        }
    };
    out.connected = true;

    // One-way network delay for this user, applied to every send and receive.
    let base = p.latency_ms / 2;
    let delay = |rng: &mut Rng| Duration::from_millis(base + if p.jitter_ms > 0 { rng.below(p.jitter_ms) } else { 0 });

    let (langs, topic) = random_profile(&mut rng);
    tokio::time::sleep(delay(&mut rng)).await;
    let joined_at = Instant::now();
    if let Err(e) = ws.send(Message::Text(json!({ "type": "join", "languages": langs, "topic": topic }).to_string().into())).await {
        out.error = Some(format!("join: {e}"));
        return (user, out);
    }

    let mut open_offer: Option<u64> = None;
    let mut ping = tokio::time::interval(Duration::from_secs(10));
    loop {
        let frame = tokio::select! {
            _ = tokio::time::sleep_until(p.deadline.into()) => break,
            _ = ping.tick() => {
                let _ = ws.send(Message::Text(json!({ "type": "ping" }).to_string().into())).await;
                continue;
            }
            frame = ws.next() => frame,
        };
        let text = match frame {
            Some(Ok(Message::Text(t))) => t,
            Some(Ok(Message::Close(_))) | None => break,
            Some(Err(e)) => {
                out.error = Some(format!("read: {e}"));
                break;
            }
            Some(Ok(_)) => continue,
        };
        tokio::time::sleep(delay(&mut rng)).await;
        let msg: Value = serde_json::from_str(text.as_str()).unwrap_or(Value::Null);
        match msg["type"].as_str().unwrap_or("") {
            "offer" => {
                out.offers += 1;
                if open_offer.is_some() {
                    out.overlapping_offers += 1;
                }
                let id = msg["match_id"].as_u64().unwrap_or(0);
                open_offer = Some(id);
                out.first_offer_ms.get_or_insert(joined_at.elapsed().as_millis());
                let roll = rng.unit();
                if roll < p.drop_rate {
                    out.dropped = true; // the phone vanishes mid-offer
                    break;
                }
                let answer = if roll < p.drop_rate + p.decline_rate { "decline" } else { "ready" };
                out.declined = answer == "decline";
                tokio::time::sleep(delay(&mut rng)).await;
                let _ = ws.send(Message::Text(json!({ "type": "respond", "match_id": id, "answer": answer }).to_string().into())).await;
            }
            "requeued" => {
                out.requeues += 1;
                open_offer = None;
            }
            "call_started" => {
                out.call_ms = Some(joined_at.elapsed().as_millis());
                out.call = Some((msg["match_id"].as_u64().unwrap_or(0), msg["partner"].as_str().unwrap_or("").to_string()));
                tokio::time::sleep(Duration::from_millis(p.hold_ms)).await;
                let _ = ws.send(Message::Text(json!({ "type": "end_call" }).to_string().into())).await;
                break;
            }
            "left" => {
                out.left_reason = msg["reason"].as_str().map(str::to_string);
                break;
            }
            "error" if msg["code"] == "no_such_offer" => out.stale_answers += 1,
            "error" => {
                out.error = Some(msg["message"].as_str().unwrap_or("error").to_string());
                break;
            }
            _ => {}
        }
    }
    let _ = ws.close(None).await;
    (user, out)
}

async fn run_network(args: &Args) {
    let users: usize = args.num("users", 1000);
    let ramp_ms: u64 = args.num("ramp-ms", 2000);
    let timeout_s: u64 = args.num("timeout-s", 30);
    let tick_ms: u64 = args.num("tick-ms", 250);

    let (url, _server) = match args.text("url") {
        Some(url) => (url.trim_end_matches('/').to_string(), None),
        None => {
            let mut cfg = ServerConfig::default();
            cfg.tick_ms = tick_ms;
            let (addr, handle) = spawn_local(cfg).await.expect("local server starts");
            (format!("ws://{addr}"), Some(handle))
        }
    };
    let params = NetParams {
        url: url.clone(),
        latency_ms: args.num("latency-ms", 0),
        jitter_ms: args.num("jitter-ms", 0),
        decline_rate: args.num("decline-rate", 0.05),
        drop_rate: args.num("drop-rate", 0.02),
        hold_ms: args.num("hold-ms", 500),
        deadline: Instant::now() + Duration::from_secs(timeout_s),
    };
    println!(
        "{users} users -> {url}   ramp {ramp_ms} ms · latency {} ms (+ up to {} ms jitter each way) · {:.0}% decline · {:.0}% drop",
        params.latency_ms,
        params.jitter_ms,
        params.decline_rate * 100.0,
        params.drop_rate * 100.0
    );

    let started = Instant::now();
    let mut tasks = Vec::with_capacity(users);
    for i in 0..users {
        let offset = Duration::from_millis(ramp_ms * i as u64 / users.max(1) as u64);
        tasks.push(tokio::spawn(simulate_user(i, offset, params.clone())));
    }
    let mut results: HashMap<String, Outcome> = HashMap::new();
    for task in tasks {
        if let Ok((user, outcome)) = task.await {
            results.insert(user, outcome);
        }
    }
    let elapsed = started.elapsed();

    // ---- correctness: every call has exactly two people who agree on it ----
    let mut by_match: HashMap<u64, Vec<&String>> = HashMap::new();
    for (user, o) in &results {
        if let Some((id, _)) = &o.call {
            by_match.entry(*id).or_default().push(user);
        }
    }
    let wrong_size = by_match.values().filter(|u| u.len() != 2).count();
    let one_sided = results
        .iter()
        .filter(|(user, o)| o.call.as_ref().is_some_and(|(_, partner)| results.get(partner).and_then(|p| p.call.as_ref()).map(|c| &c.1) != Some(*user)))
        .count();
    let overlapping: u32 = results.values().map(|o| o.overlapping_offers).sum();

    let count = |f: &dyn Fn(&Outcome) -> bool| results.values().filter(|o| f(o)).count();
    let connected = count(&|o| o.connected);
    let called = count(&|o| o.call.is_some());
    let errors: Vec<&String> = results.values().filter_map(|o| o.error.as_ref()).collect();
    let mut offer_ms: Vec<u128> = results.values().filter_map(|o| o.first_offer_ms).collect();
    let mut call_ms: Vec<u128> = results.values().filter_map(|o| o.call_ms).collect();
    offer_ms.sort_unstable();
    call_ms.sort_unstable();

    println!("\nfinished in {:.1} s", elapsed.as_secs_f64());
    println!("  connected            {connected} / {users}");
    println!("  reached a call       {called}  ({} calls)", by_match.len());
    println!("  declined an offer    {}", count(&|o| o.declined && o.call.is_none()));
    println!("  dropped mid-offer    {}", count(&|o| o.dropped));
    println!("  sent back to queue   {} times in total", results.values().map(|o| o.requeues).sum::<u32>());
    println!("  offer timed out      {}", count(&|o| o.left_reason.as_deref() == Some("offer_timeout")));
    println!(
        "  still waiting at end {}",
        count(&|o| o.connected && o.call.is_none() && !o.declined && !o.dropped && o.left_reason.is_none() && o.error.is_none())
    );
    println!("  late answers ignored {}", results.values().map(|o| o.stale_answers).sum::<u32>());
    println!("  errors               {}", errors.len());
    if let Some(first) = errors.first() {
        println!("    first error: {first}");
        if first.contains("Too many open files") {
            println!("    raise the limit first:  ulimit -n 20000");
        }
    }
    let line = |name: &str, v: &[u128]| {
        println!(
            "  {name:<20} p50 {} ms · p95 {} ms · p99 {} ms · max {} ms   (n={})",
            percentile(v, 0.50),
            percentile(v, 0.95),
            percentile(v, 0.99),
            v.last().copied().unwrap_or(0),
            v.len()
        );
    };
    println!("\nlatency as the user sees it");
    line("join -> first offer", &offer_ms);
    line("join -> call started", &call_ms);

    println!("\ncorrectness");
    println!("  calls without exactly two people   {wrong_size}");
    println!("  users whose partner disagrees      {one_sided}");
    println!("  offers received while one was open {overlapping}");
    let ok = wrong_size == 0 && one_sided == 0 && overlapping == 0 && connected == users;
    println!("\n{}", if ok { "PASS" } else { "FAIL" });
    if !ok {
        std::process::exit(1);
    }
}

#[tokio::main]
async fn main() {
    let raw: Vec<String> = std::env::args().skip(1).collect();
    let args = Args::parse(&raw);
    match raw.first().map(String::as_str) {
        Some("engine") => run_engine(&args),
        Some("network") => run_network(&args).await,
        _ => {
            eprintln!("usage: loadtest engine [--sizes 1000,10000] | loadtest network [--users 2000] [--latency-ms 150] ...");
            std::process::exit(2);
        }
    }
}
