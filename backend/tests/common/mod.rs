//! Small helpers shared by the engine tests.
#![allow(dead_code)]

use matchmaking::engine::{Answer, Config, Engine, Event, EventKind, MatchId, PartnerRequest, Phase};

pub fn engine() -> Engine {
    Engine::new(Config::default(), &[])
}

pub fn engine_with(requests: &[(&[&str], Option<&str>)]) -> Engine {
    let list: Vec<PartnerRequest> = requests
        .iter()
        .map(|(langs, topic)| PartnerRequest {
            languages: langs.iter().map(|l| l.to_string()).collect(),
            topic: topic.map(str::to_string),
        })
        .collect();
    Engine::new(Config::default(), &list)
}

pub fn join(e: &mut Engine, user: &str, langs: &[&str], topic: Option<&str>, now: u64) {
    let langs: Vec<String> = langs.iter().map(|l| l.to_string()).collect();
    e.join(user, &langs, topic, now).unwrap_or_else(|err| panic!("{user} could not join: {err}"));
}

/// One entry per offer made: (the two users sorted, shared languages, agreed topic).
pub fn offers(events: &[Event]) -> Vec<((String, String), Vec<String>, Option<String>)> {
    let mut seen = std::collections::BTreeMap::new();
    for ev in events {
        if let EventKind::Offer { match_id, partner, languages, topic, .. } = &ev.kind {
            let mut pair = [ev.user.clone(), partner.clone()];
            pair.sort();
            let [a, b] = pair;
            seen.entry(*match_id).or_insert(((a, b), languages.clone(), topic.clone()));
        }
    }
    seen.into_values().collect()
}

/// Just the pairs, as "a+b" strings in the order the offers were made.
pub fn pairs(events: &[Event]) -> Vec<String> {
    offers(events).into_iter().map(|((a, b), _, _)| format!("{a}+{b}")).collect()
}

pub fn match_id(e: &Engine, user: &str) -> MatchId {
    match e.phase(user) {
        Phase::Offered { match_id } | Phase::InCall { match_id } => match_id,
        other => panic!("{user} has no match: {other:?}"),
    }
}

pub fn ready(e: &mut Engine, user: &str, now: u64) -> Vec<Event> {
    let id = match_id(e, user);
    e.respond(user, id, Answer::Ready, false, now).unwrap()
}

pub fn decline(e: &mut Engine, user: &str, never_again: bool, now: u64) -> Vec<Event> {
    let id = match_id(e, user);
    e.respond(user, id, Answer::Decline, never_again, now).unwrap()
}

pub fn kinds_for<'a>(events: &'a [Event], user: &str) -> Vec<&'a EventKind> {
    events.iter().filter(|ev| ev.user == user).map(|ev| &ev.kind).collect()
}
