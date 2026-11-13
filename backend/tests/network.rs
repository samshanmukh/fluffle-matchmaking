//! End-to-end tests over real WebSockets against a server on a local port.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use matchmaking::server::{ServerConfig, spawn_local};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_tungstenite::tungstenite::Message;

type Ws = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

fn fast() -> ServerConfig {
    let mut cfg = ServerConfig::default();
    cfg.tick_ms = 20;
    cfg.partner_requests.clear();
    cfg
}

struct Client {
    ws: Ws,
}

impl Client {
    async fn connect(addr: SocketAddr, user: &str) -> Self {
        // Ben says where he is (in lower case); Ana sends something that is not a country code.
        let region = match user {
            "ben" => "&region=br",
            "ana" => "&region=mars",
            _ => "",
        };
        let url = format!("ws://{addr}/ws?user_id={user}&name={user}-name{region}");
        let (ws, _) = tokio_tungstenite::connect_async(url).await.expect("connects");
        let mut c = Client { ws };
        assert_eq!(c.wait_for("hello").await["user_id"], user);
        c
    }

    async fn send(&mut self, msg: Value) {
        self.ws.send(Message::Text(msg.to_string().into())).await.expect("sends");
    }

    /// The next JSON message, or `None` if the server closed the socket.
    async fn next(&mut self) -> Option<Value> {
        loop {
            let frame = tokio::time::timeout(Duration::from_secs(5), self.ws.next()).await.expect("server went quiet");
            match frame {
                Some(Ok(Message::Text(t))) => return Some(serde_json::from_str(t.as_str()).expect("json")),
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return None,
                Some(Ok(_)) => continue,
            }
        }
    }

    /// Skips other messages (estimate updates and so on) until one of this type arrives.
    async fn wait_for(&mut self, kind: &str) -> Value {
        loop {
            let msg = self.next().await.unwrap_or_else(|| panic!("socket closed while waiting for {kind}"));
            if msg["type"] == kind {
                return msg;
            }
            assert_ne!(msg["type"], "error", "unexpected error: {msg}");
        }
    }

    async fn join(&mut self, languages: &[&str], topic: Option<&str>) {
        self.send(json!({ "type": "join", "languages": languages, "topic": topic })).await;
        self.wait_for("joined").await;
    }
}

#[tokio::test]
async fn two_people_match_answer_ready_and_talk() {
    let (addr, _server) = spawn_local(fast()).await.unwrap();
    let mut ana = Client::connect(addr, "ana").await;
    let mut ben = Client::connect(addr, "ben").await;
    ana.join(&["English", "Spanish"], Some("sports")).await;
    ben.join(&["english"], Some("sports")).await;

    let offer_a = ana.wait_for("offer").await;
    let offer_b = ben.wait_for("offer").await;
    assert_eq!(offer_a["match_id"], offer_b["match_id"]);
    assert_eq!(offer_a["partner"], "ben");
    assert_eq!(offer_a["partner_name"], "ben-name");
    assert_eq!(offer_a["partner_region"], "BR");
    assert_eq!(offer_b["partner_region"], Value::Null);
    assert_eq!(offer_a["languages"], json!(["english"]));
    assert_eq!(offer_a["topic"], "sports");
    assert_eq!(offer_a["expires_in_ms"], 15_000);

    let id = offer_a["match_id"].clone();
    ana.send(json!({ "type": "respond", "match_id": id, "answer": "ready" })).await;
    ben.send(json!({ "type": "respond", "match_id": id, "answer": "ready" })).await;
    let call = ana.wait_for("call_started").await;
    assert_eq!(call["partner"], "ben");
    assert_eq!(ben.wait_for("call_started").await["partner"], "ana");

    ana.send(json!({ "type": "end_call" })).await;
    assert_eq!(ana.wait_for("call_ended").await["reason"], "you_ended");
    assert_eq!(ben.wait_for("call_ended").await["reason"], "partner_left");
}

#[tokio::test]
async fn a_decline_with_dont_match_again_is_delivered_to_both() {
    let (addr, _server) = spawn_local(fast()).await.unwrap();
    let mut ana = Client::connect(addr, "ana").await;
    let mut ben = Client::connect(addr, "ben").await;
    ana.join(&["en"], None).await;
    ben.join(&["en"], None).await;
    let id = ana.wait_for("offer").await["match_id"].clone();
    ben.wait_for("offer").await;

    ben.send(json!({ "type": "respond", "match_id": id, "answer": "decline", "never_again": true })).await;
    assert_eq!(ben.wait_for("left").await["reason"], "declined");
    assert_eq!(ana.wait_for("requeued").await["reason"], "partner_declined");

    // ben comes straight back; they must not be offered each other again.
    ben.join(&["en"], None).await;
    let mut carl = Client::connect(addr, "carl").await;
    carl.join(&["en"], None).await;
    assert_eq!(ana.wait_for("offer").await["partner"], "carl", "ana kept her place and got the next person");
}

#[tokio::test]
async fn a_disconnect_during_an_offer_sends_the_partner_back_to_the_queue() {
    let (addr, _server) = spawn_local(fast()).await.unwrap();
    let mut ana = Client::connect(addr, "ana").await;
    let mut ben = Client::connect(addr, "ben").await;
    ana.join(&["en"], None).await;
    ben.join(&["en"], None).await;
    ana.wait_for("offer").await;
    ben.wait_for("offer").await;
    drop(ben); // the phone loses signal
    assert_eq!(ana.wait_for("requeued").await["reason"], "partner_declined");
}

#[tokio::test]
async fn a_connection_that_goes_silent_is_dropped() {
    let mut cfg = fast();
    cfg.heartbeat_timeout_ms = 300;
    let (addr, _server) = spawn_local(cfg).await.unwrap();
    let mut ghost = Client::connect(addr, "ghost").await;
    ghost.join(&["en"], None).await;
    // No pings: the server gives up on the connection and frees the place.
    while ghost.next().await.is_some() {}
    let mut ana = Client::connect(addr, "ana").await;
    let mut ben = Client::connect(addr, "ben").await;
    ana.join(&["en"], None).await;
    ben.join(&["en"], None).await;
    assert_eq!(ana.wait_for("offer").await["partner"], "ben", "the ghost was not offered to anyone");
}

#[tokio::test]
async fn pings_keep_a_waiting_connection_alive() {
    let mut cfg = fast();
    cfg.heartbeat_timeout_ms = 300;
    let (addr, _server) = spawn_local(cfg).await.unwrap();
    let mut ana = Client::connect(addr, "ana").await;
    ana.join(&["en"], None).await;
    for _ in 0..6 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        ana.send(json!({ "type": "ping" })).await;
        ana.wait_for("pong").await;
    }
    let mut ben = Client::connect(addr, "ben").await;
    ben.join(&["en"], None).await;
    assert_eq!(ben.wait_for("offer").await["partner"], "ana");
}

#[tokio::test]
async fn mistakes_get_an_error_message_not_a_dropped_socket() {
    let (addr, _server) = spawn_local(fast()).await.unwrap();
    let mut ana = Client::connect(addr, "ana").await;
    ana.send(json!({ "type": "join", "languages": [] })).await;
    assert_eq!(ana.next().await.unwrap()["code"], "no_languages");
    ana.send(json!({ "type": "dance" })).await;
    assert_eq!(ana.next().await.unwrap()["code"], "bad_message");
    ana.join(&["en"], None).await;
    ana.send(json!({ "type": "join", "languages": ["en"] })).await;
    let err = loop {
        let m = ana.next().await.unwrap();
        if m["type"] == "error" {
            break m;
        }
    };
    assert_eq!(err["code"], "already_active", "one place in the queue at a time");
}

#[tokio::test]
async fn the_start_screen_can_ask_for_an_estimate_over_http() {
    let (addr, _server) = spawn_local(fast()).await.unwrap();
    let get = |path: &'static str| async move {
        let mut tcp = tokio::net::TcpStream::connect(addr).await.unwrap();
        tcp.write_all(format!("GET {path} HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
        let mut body = String::new();
        tcp.read_to_string(&mut body).await.unwrap();
        body
    };
    assert!(get("/estimate?languages=en,es").await.contains("\"bucket\":\"unknown\""));
    let mut ana = Client::connect(addr, "ana").await;
    ana.join(&["es"], None).await;
    assert!(get("/estimate?languages=en,es").await.contains("\"bucket\":\"under_a_minute\""));

    // The "who's online" list: counts, an avatar code, a region and a waiting flag; never a name or an id.
    let here = get("/presence?languages=en,es").await;
    assert!(here.contains("\"online\":1") && here.contains("\"waiting\":1"), "{here}");
    assert!(here.contains("\"avatar\":") && here.contains("\"waiting\":true"), "{here}");
    assert!(!here.contains("ana") && !here.contains("ben"), "{here}");

    // Someone online who does not share a language is still listed, but not as ready to match.
    let other = get("/presence?languages=klingon").await;
    assert!(other.contains("\"online\":1") && other.contains("\"waiting\":0") && other.contains("\"waiting\":false"), "{other}");

    // You are never listed to yourself.
    assert!(get("/presence?languages=es&user_id=ana").await.contains("\"online\":0"));
}

#[tokio::test]
async fn a_client_that_never_reads_is_disconnected_instead_of_filling_memory() {
    let (addr, _server) = spawn_local(fast()).await.unwrap();
    let mut hog = Client::connect(addr, "hog").await;
    hog.join(&["en"], None).await;
    // Ask for far more replies than the queue holds, and read none of them.
    let ping = json!({ "type": "ping" }).to_string();
    for _ in 0..400_000 {
        if hog.ws.send(Message::Text(ping.clone().into())).await.is_err() {
            break; // the server already hung up
        }
    }
    // The server must have dropped the connection well before answering them all.
    let mut pongs = 0;
    while let Ok(Some(Ok(_))) = tokio::time::timeout(Duration::from_secs(5), hog.ws.next()).await {
        pongs += 1;
    }
    assert!(pongs < 400_000, "every reply was queued: the outbound queue is unbounded");
    // And the place in the queue was freed: two new people pair with each other.
    let mut ana = Client::connect(addr, "ana").await;
    let mut ben = Client::connect(addr, "ben").await;
    ana.join(&["en"], None).await;
    ben.join(&["en"], None).await;
    assert_eq!(ana.wait_for("offer").await["partner"], "ben");
}

/// The brief's concurrency requirement, over the real network path: many
/// people join at once; nobody ends up in two matches, nobody is dropped.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_crowd_joining_at_once_all_end_up_in_exactly_one_call() {
    const USERS: usize = 100;
    let (addr, _server) = spawn_local(fast()).await.unwrap();

    let mut tasks = Vec::new();
    for i in 0..USERS {
        tasks.push(tokio::spawn(async move {
            let user = format!("user{i}");
            let mut c = Client::connect(addr, &user).await;
            c.join(&["en"], None).await;
            let mut offers = 0;
            loop {
                let msg = c.next().await.expect("socket stays open");
                match msg["type"].as_str().unwrap() {
                    "offer" => {
                        offers += 1;
                        c.send(json!({ "type": "respond", "match_id": msg["match_id"], "answer": "ready" })).await;
                    }
                    "call_started" => {
                        // Stay connected so the partner's call is not ended under them.
                        let result = (user, msg["match_id"].as_u64().unwrap(), msg["partner"].as_str().unwrap().to_string(), offers);
                        return (result, c);
                    }
                    "left" | "requeued" | "error" => panic!("{user} got {msg}"),
                    _ => {}
                }
            }
        }));
    }

    let mut partner_of = HashMap::new();
    let mut by_match: HashMap<u64, Vec<String>> = HashMap::new();
    let mut keep_open = Vec::new();
    for task in tasks {
        let ((user, match_id, partner, offers), client) =
            tokio::time::timeout(Duration::from_secs(20), task).await.expect("everyone is matched").unwrap();
        assert_eq!(offers, 1, "{user} was offered more than one match");
        by_match.entry(match_id).or_default().push(user.clone());
        partner_of.insert(user, partner);
        keep_open.push(client);
    }
    assert_eq!(partner_of.len(), USERS, "nobody was dropped");
    assert_eq!(by_match.len(), USERS / 2);
    for (id, users) in &by_match {
        assert_eq!(users.len(), 2, "match {id} has {users:?}");
    }
    for (user, partner) in &partner_of {
        assert_eq!(&partner_of[partner], user, "{user} and {partner} disagree about who they matched");
    }
}
