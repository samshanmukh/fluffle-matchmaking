//! The pairing engine: who is waiting, who has an offer open, who is on a call.
//!
//! It is a plain state machine with no I/O, no threads and no clock of its
//! own. The server owns one `Engine` behind one lock and passes in `now`, so
//! every transition is atomic and every test is deterministic.

pub mod select;
mod types;

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

use select::{Candidate, Pairing, Requests};
pub use types::*;

#[derive(Default)]
struct Interner {
    ids: HashMap<String, u32>,
    names: Vec<String>,
}

impl Interner {
    fn intern(&mut self, s: &str) -> u32 {
        if let Some(&id) = self.ids.get(s) {
            return id;
        }
        let id = self.names.len() as u32;
        self.names.push(s.to_string());
        self.ids.insert(s.to_string(), id);
        id
    }
    fn get(&self, s: &str) -> Option<u32> {
        self.ids.get(s).copied()
    }
    fn name(&self, id: u32) -> &str {
        &self.names[id as usize]
    }
}

#[derive(Clone, Debug)]
struct Waiter {
    cand: Candidate,
    /// When the wait budget runs out. Reset when returned to the queue;
    /// `cand.seniority` is not, which is what "back to the front" means.
    deadline: Ms,
    last_estimate: Option<Estimate>,
}

#[derive(Debug)]
struct Offer {
    sides: [Waiter; 2],
    answers: [Option<Answer>; 2],
    shared: Vec<LangId>,
    topic: Option<TopicId>,
    deadline: Ms,
}

#[derive(Debug)]
struct Call {
    users: [Uid; 2],
}

#[derive(Debug)]
enum Slot {
    Waiting(Waiter),
    Offered(MatchId),
    InCall(MatchId),
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct Stats {
    pub waiting: usize,
    pub open_offers: usize,
    pub calls: usize,
}

pub struct Engine {
    cfg: Config,
    users: Interner,
    langs: Interner,
    topics: Interner,
    /// Every active user is in exactly one slot. Idle users have none.
    slots: HashMap<Uid, Slot>,
    offers: BTreeMap<MatchId, Offer>,
    calls: BTreeMap<MatchId, Call>,
    /// Blocks and "don't match me again": never paired, in either direction.
    blocks: HashSet<(Uid, Uid)>,
    /// Temporary cooldowns: pair -> not before this time.
    avoid: HashMap<(Uid, Uid), Ms>,
    requests: Requests,
    next_seq: u64,
    next_match: MatchId,
    /// How many waiting people speak each language (for the estimate).
    lang_waiting: HashMap<LangId, usize>,
    /// Recent completed waits per language: (when matched, how long they waited).
    /// Stored under every language of the call, tagged with a sample id so a
    /// wait is counted once however many of those languages a query spans.
    samples: HashMap<LangId, VecDeque<(u64, Ms, Ms)>>,
    next_sample: u64,
    /// Test hook: run the O(n²) reference selection instead of the indexed one.
    pub use_reference_selection: bool,
}

fn normalize(s: &str) -> String {
    s.trim().to_lowercase()
}

fn pair_key(a: Uid, b: Uid) -> (Uid, Uid) {
    if a < b { (a, b) } else { (b, a) }
}

const MINUTE: Ms = 60_000;

fn bucket_of(wait_ms: Ms) -> Bucket {
    if wait_ms < MINUTE {
        Bucket::UnderAMinute
    } else if wait_ms < 5 * MINUTE {
        Bucket::AFewMinutes
    } else {
        Bucket::OverFiveMinutes
    }
}

impl Engine {
    pub fn new(cfg: Config, partner_requests: &[PartnerRequest]) -> Self {
        let mut langs = Interner::default();
        let mut topics = Interner::default();
        let list: Vec<(Vec<LangId>, Option<TopicId>)> = partner_requests
            .iter()
            .map(|r| {
                let set = r.languages.iter().map(|l| langs.intern(&normalize(l))).collect();
                let topic = r.topic.as_deref().map(normalize).filter(|t| !t.is_empty()).map(|t| topics.intern(&t));
                (set, topic)
            })
            .collect();
        Self {
            cfg,
            users: Interner::default(),
            langs,
            topics,
            slots: HashMap::new(),
            offers: BTreeMap::new(),
            calls: BTreeMap::new(),
            blocks: HashSet::new(),
            avoid: HashMap::new(),
            requests: Requests::new(list),
            next_seq: 0,
            next_match: 1,
            lang_waiting: HashMap::new(),
            samples: HashMap::new(),
            next_sample: 0,
            use_reference_selection: false,
        }
    }

    pub fn config(&self) -> &Config {
        &self.cfg
    }

    // ------------------------------------------------------------------
    // Commands
    // ------------------------------------------------------------------

    /// Join the queue. Returns the wait estimate shown as the wait begins.
    pub fn join(&mut self, user: &str, languages: &[String], topic: Option<&str>, now: Ms) -> Result<Estimate, EngineError> {
        let mut names: Vec<String> = languages.iter().map(|l| normalize(l)).filter(|l| !l.is_empty()).collect();
        names.sort();
        names.dedup();
        if names.is_empty() {
            return Err(EngineError::NoLanguages);
        }
        if names.len() > self.cfg.max_languages {
            return Err(EngineError::TooManyLanguages { max: self.cfg.max_languages });
        }
        let uid = self.users.intern(user);
        if self.slots.contains_key(&uid) {
            return Err(EngineError::AlreadyActive);
        }
        let mut langs: Vec<LangId> = names.iter().map(|l| self.langs.intern(l)).collect();
        langs.sort_unstable();
        let topic = topic.map(normalize).filter(|t| !t.is_empty()).map(|t| self.topics.intern(&t));

        let estimate = self.estimate_before_joining(&langs, now);
        let seq = self.next_seq;
        self.next_seq += 1;
        self.enter_waiting(Waiter {
            cand: Candidate { uid, langs, topic, seniority: now, seq },
            deadline: now + self.cfg.wait_budget_ms,
            last_estimate: Some(estimate),
        });
        Ok(estimate)
    }

    /// Leave from anywhere: cancels a wait, counts as a decline during an
    /// offer, ends a call. Idle users are left alone.
    pub fn leave(&mut self, user: &str, now: Ms) -> Vec<Event> {
        let mut events = Vec::new();
        let Some(uid) = self.users.get(user) else { return events };
        match self.slots.get(&uid) {
            None => {}
            Some(Slot::Waiting(_)) => {
                self.take_waiting(uid);
                self.push(&mut events, uid, EventKind::Left { reason: LeftReason::Cancelled });
            }
            Some(Slot::Offered(id)) => {
                let id = *id;
                self.decline(uid, id, false, LeftReason::Cancelled, now, &mut events);
            }
            Some(Slot::InCall(_)) => {
                let _ = self.end_call_inner(uid, now, &mut events);
            }
        }
        events
    }

    /// Answer a match offer.
    pub fn respond(
        &mut self,
        user: &str,
        match_id: MatchId,
        answer: Answer,
        never_again: bool,
        now: Ms,
    ) -> Result<Vec<Event>, EngineError> {
        let mut events = Vec::new();
        let uid = self.users.get(user).ok_or(EngineError::NoSuchOffer)?;
        let Some(offer) = self.offers.get_mut(&match_id) else { return Err(EngineError::NoSuchOffer) };
        let Some(side) = offer.sides.iter().position(|w| w.cand.uid == uid) else {
            return Err(EngineError::NoSuchOffer);
        };
        // An answer that arrives after the window closed does not count, even
        // if the tick that expires the offer has not run yet.
        if now >= offer.deadline {
            self.expire_offer(match_id, now, &mut events);
            return Ok(events);
        }
        match answer {
            Answer::Decline => self.decline(uid, match_id, never_again, LeftReason::Declined, now, &mut events),
            Answer::Ready => {
                offer.answers[side] = Some(Answer::Ready);
                if offer.answers.iter().all(|a| *a == Some(Answer::Ready)) {
                    self.start_call(match_id, now, &mut events);
                }
            }
        }
        Ok(events)
    }

    pub fn end_call(&mut self, user: &str, now: Ms) -> Result<Vec<Event>, EngineError> {
        let mut events = Vec::new();
        let uid = self.users.get(user).ok_or(EngineError::NotInCall)?;
        self.end_call_inner(uid, now, &mut events)?;
        Ok(events)
    }

    /// Block another user. Symmetric and permanent: the two are never paired.
    /// If the two have an offer open right now, blocking closes it exactly
    /// like "decline, don't match me again": the blocker leaves, the other
    /// person goes back to the queue.
    pub fn block(&mut self, user: &str, other: &str, now: Ms) -> Result<Vec<Event>, EngineError> {
        let a = self.users.intern(user);
        let b = self.users.intern(other);
        if a == b {
            return Err(EngineError::CannotBlockSelf);
        }
        self.blocks.insert(pair_key(a, b));
        let mut events = Vec::new();
        if let (Some(Slot::Offered(x)), Some(Slot::Offered(y))) = (self.slots.get(&a), self.slots.get(&b)) {
            if x == y {
                let id = *x;
                self.decline(a, id, true, LeftReason::Declined, now, &mut events);
            }
        }
        Ok(events)
    }

    /// One pass: close expired offers, time out long waits, pair whoever can
    /// be paired, and report estimate changes.
    pub fn tick(&mut self, now: Ms) -> Vec<Event> {
        let mut events = Vec::new();

        let due: Vec<MatchId> = self.offers.iter().filter(|(_, o)| o.deadline <= now).map(|(id, _)| *id).collect();
        for id in due {
            self.expire_offer(id, now, &mut events);
        }

        let mut timed_out: Vec<(Ms, u64, Uid)> = self
            .slots
            .values()
            .filter_map(|s| match s {
                Slot::Waiting(w) if w.deadline <= now => Some((w.cand.seniority, w.cand.seq, w.cand.uid)),
                _ => None,
            })
            .collect();
        timed_out.sort_unstable();
        for (_, _, uid) in timed_out {
            self.take_waiting(uid);
            self.push(&mut events, uid, EventKind::Left { reason: LeftReason::WaitTimeout });
        }

        self.avoid.retain(|_, until| *until > now);

        for pairing in self.select(now) {
            self.open_offer(pairing, now, &mut events);
        }

        self.report_estimates(now, &mut events);
        events
    }

    // ------------------------------------------------------------------
    // Queries
    // ------------------------------------------------------------------

    pub fn phase(&self, user: &str) -> Phase {
        match self.users.get(user).and_then(|uid| self.slots.get(&uid)) {
            None => Phase::Idle,
            Some(Slot::Waiting(_)) => Phase::Waiting,
            Some(Slot::Offered(id)) => Phase::Offered { match_id: *id },
            Some(Slot::InCall(id)) => Phase::InCall { match_id: *id },
        }
    }

    pub fn stats(&self) -> Stats {
        Stats {
            waiting: self.slots.values().filter(|s| matches!(s, Slot::Waiting(_))).count(),
            open_offers: self.offers.len(),
            calls: self.calls.len(),
        }
    }

    /// The estimate shown on the start screen, before joining.
    pub fn estimate(&self, languages: &[String], now: Ms) -> Estimate {
        let mut langs: Vec<LangId> = languages.iter().filter_map(|l| self.langs.get(&normalize(l))).collect();
        langs.sort_unstable();
        langs.dedup();
        self.estimate_before_joining(&langs, now)
    }

    /// Checks the properties the brief asks for: nobody is in two places, and
    /// every offer and call refers to people who know they are in it.
    pub fn check_invariants(&self) -> Result<(), String> {
        let mut seen: HashMap<Uid, &'static str> = HashMap::new();
        let mut claim = |uid: Uid, place: &'static str| match seen.insert(uid, place) {
            Some(prev) => Err(format!("user {uid} is in two places: {prev} and {place}")),
            None => Ok(()),
        };
        for (id, offer) in &self.offers {
            let [a, b] = [offer.sides[0].cand.uid, offer.sides[1].cand.uid];
            if a == b {
                return Err(format!("offer {id} pairs user {a} with themselves"));
            }
            if self.blocks.contains(&pair_key(a, b)) {
                return Err(format!("offer {id} pairs blocked users {a} and {b}"));
            }
            for uid in [a, b] {
                claim(uid, "offer")?;
                if !matches!(self.slots.get(&uid), Some(Slot::Offered(m)) if m == id) {
                    return Err(format!("user {uid} is in offer {id} but their slot disagrees"));
                }
            }
        }
        for (id, call) in &self.calls {
            for uid in call.users {
                claim(uid, "call")?;
                if !matches!(self.slots.get(&uid), Some(Slot::InCall(m)) if m == id) {
                    return Err(format!("user {uid} is in call {id} but their slot disagrees"));
                }
            }
        }
        let mut counts: HashMap<LangId, usize> = HashMap::new();
        for (uid, slot) in &self.slots {
            match slot {
                Slot::Waiting(w) => {
                    claim(*uid, "queue")?;
                    for l in &w.cand.langs {
                        *counts.entry(*l).or_default() += 1;
                    }
                }
                Slot::Offered(id) if !self.offers.contains_key(id) => {
                    return Err(format!("user {uid} points at missing offer {id}"));
                }
                Slot::InCall(id) if !self.calls.contains_key(id) => {
                    return Err(format!("user {uid} points at missing call {id}"));
                }
                _ => {}
            }
        }
        let tracked: HashMap<LangId, usize> = self.lang_waiting.iter().filter(|(_, n)| **n > 0).map(|(l, n)| (*l, *n)).collect();
        if tracked != counts {
            return Err("per-language waiting counts drifted from the queue".to_string());
        }
        Ok(())
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    fn push(&self, events: &mut Vec<Event>, uid: Uid, kind: EventKind) {
        events.push(Event { user: self.users.name(uid).to_string(), kind });
    }

    fn enter_waiting(&mut self, w: Waiter) {
        for l in &w.cand.langs {
            *self.lang_waiting.entry(*l).or_default() += 1;
        }
        self.slots.insert(w.cand.uid, Slot::Waiting(w));
    }

    fn take_waiting(&mut self, uid: Uid) -> Option<Waiter> {
        if !matches!(self.slots.get(&uid), Some(Slot::Waiting(_))) {
            return None;
        }
        let Some(Slot::Waiting(w)) = self.slots.remove(&uid) else { unreachable!() };
        for l in &w.cand.langs {
            if let Some(n) = self.lang_waiting.get_mut(l) {
                *n = n.saturating_sub(1);
            }
        }
        Some(w)
    }

    fn vetoed(&self, a: Uid, b: Uid, now: Ms) -> bool {
        let key = pair_key(a, b);
        self.blocks.contains(&key) || self.avoid.get(&key).is_some_and(|until| *until > now)
    }

    fn select(&self, now: Ms) -> Vec<Pairing> {
        let cands: Vec<Candidate> = self
            .slots
            .values()
            .filter_map(|s| match s {
                Slot::Waiting(w) => Some(w.cand.clone()),
                _ => None,
            })
            .collect();
        if cands.len() < 2 {
            return Vec::new();
        }
        let vetoed = |a: Uid, b: Uid| self.vetoed(a, b, now);
        if self.use_reference_selection {
            select::select_naive(&cands, &self.requests, &vetoed)
        } else {
            select::select_indexed(&cands, &self.requests, &vetoed)
        }
    }

    fn lang_names(&self, langs: &[LangId]) -> Vec<String> {
        let mut names: Vec<String> = langs.iter().map(|l| self.langs.name(*l).to_string()).collect();
        names.sort();
        names
    }

    fn open_offer(&mut self, p: Pairing, now: Ms, events: &mut Vec<Event>) {
        let (Some(a), Some(b)) = (self.take_waiting(p.older), self.take_waiting(p.younger)) else {
            unreachable!("selection only returns people who are waiting");
        };
        let id = self.next_match;
        self.next_match += 1;
        self.slots.insert(p.older, Slot::Offered(id));
        self.slots.insert(p.younger, Slot::Offered(id));

        let languages = self.lang_names(&p.shared);
        let topic = p.topic.map(|t| self.topics.name(t).to_string());
        for (me, partner) in [(p.older, p.younger), (p.younger, p.older)] {
            self.push(
                events,
                me,
                EventKind::Offer {
                    match_id: id,
                    partner: self.users.name(partner).to_string(),
                    languages: languages.clone(),
                    topic: topic.clone(),
                    expires_in_ms: self.cfg.offer_window_ms,
                },
            );
        }
        self.offers.insert(
            id,
            Offer { sides: [a, b], answers: [None, None], shared: p.shared, topic: p.topic, deadline: now + self.cfg.offer_window_ms },
        );
    }

    fn start_call(&mut self, id: MatchId, now: Ms, events: &mut Vec<Event>) {
        let Some(offer) = self.offers.remove(&id) else { return };
        let users = [offer.sides[0].cand.uid, offer.sides[1].cand.uid];
        let languages = self.lang_names(&offer.shared);
        let topic = offer.topic.map(|t| self.topics.name(t).to_string());
        for (i, w) in offer.sides.iter().enumerate() {
            self.slots.insert(w.cand.uid, Slot::InCall(id));
            // A real wait that ended in a call: this is what the estimate learns from.
            let waited = now.saturating_sub(w.cand.seniority);
            let sample = self.next_sample;
            self.next_sample += 1;
            for l in &offer.shared {
                let q = self.samples.entry(*l).or_default();
                q.push_back((sample, now, waited));
                while q.len() > self.cfg.estimate_max_samples {
                    q.pop_front();
                }
            }
            self.push(
                events,
                w.cand.uid,
                EventKind::CallStarted {
                    match_id: id,
                    partner: self.users.name(users[1 - i]).to_string(),
                    languages: languages.clone(),
                    topic: topic.clone(),
                },
            );
        }
        self.calls.insert(id, Call { users });
    }

    /// One person says no (or walks away). They leave; the other goes back to
    /// the queue with their place kept. Resolves at once: no reason to make
    /// the other person sit through the rest of the countdown.
    fn decline(&mut self, uid: Uid, id: MatchId, never_again: bool, reason: LeftReason, now: Ms, events: &mut Vec<Event>) {
        let Some(offer) = self.offers.remove(&id) else { return };
        let [a, b] = offer.sides;
        let (leaver, other) = if a.cand.uid == uid { (a, b) } else { (b, a) };
        let key = pair_key(leaver.cand.uid, other.cand.uid);
        if never_again {
            self.blocks.insert(key);
        } else {
            self.avoid.insert(key, now + self.cfg.decline_cooldown_ms);
        }
        self.slots.remove(&leaver.cand.uid);
        self.push(events, leaver.cand.uid, EventKind::Left { reason });
        self.requeue(other, RequeueReason::PartnerDeclined, now, events);
    }

    /// The window closed. Whoever did not answer leaves; someone who said
    /// ready goes back to the queue. If neither answered, both leave.
    fn expire_offer(&mut self, id: MatchId, now: Ms, events: &mut Vec<Event>) {
        let Some(offer) = self.offers.remove(&id) else { return };
        let key = pair_key(offer.sides[0].cand.uid, offer.sides[1].cand.uid);
        self.avoid.insert(key, now + self.cfg.decline_cooldown_ms);
        let answers = offer.answers;
        for (w, answer) in offer.sides.into_iter().zip(answers) {
            if answer == Some(Answer::Ready) {
                self.requeue(w, RequeueReason::PartnerTimedOut, now, events);
            } else {
                self.slots.remove(&w.cand.uid);
                self.push(events, w.cand.uid, EventKind::Left { reason: LeftReason::OfferTimeout });
            }
        }
    }

    fn requeue(&mut self, mut w: Waiter, reason: RequeueReason, now: Ms, events: &mut Vec<Event>) {
        // Fresh wait budget, same seniority: still ahead of everyone who joined later.
        w.deadline = now + self.cfg.wait_budget_ms;
        w.last_estimate = None;
        let uid = w.cand.uid;
        self.slots.remove(&uid);
        self.enter_waiting(w);
        self.push(events, uid, EventKind::Requeued { reason, wait_budget_ms: self.cfg.wait_budget_ms });
    }

    fn end_call_inner(&mut self, uid: Uid, now: Ms, events: &mut Vec<Event>) -> Result<(), EngineError> {
        let Some(Slot::InCall(id)) = self.slots.get(&uid) else { return Err(EngineError::NotInCall) };
        let id = *id;
        let Some(call) = self.calls.remove(&id) else { return Err(EngineError::NotInCall) };
        self.avoid.insert(pair_key(call.users[0], call.users[1]), now + self.cfg.recent_partner_cooldown_ms);
        for u in call.users {
            self.slots.remove(&u);
            let reason = if u == uid { CallEndReason::YouEnded } else { CallEndReason::PartnerLeft };
            self.push(events, u, EventKind::CallEnded { match_id: id, reason });
        }
        Ok(())
    }

    // ---- wait estimate -------------------------------------------------
    //
    // The rule, in one place:
    //  * Before joining: if someone who shares a language is waiting right
    //    now, "under a minute". Otherwise the median of recent real waits for
    //    those languages. With fewer than `estimate_min_samples`, unknown.
    //  * While waiting: the same median, but never a bucket the person has
    //    already outlasted. Presence of others is ignored here: if they were
    //    pairable, the last pass would have paired them.

    fn recent_waits(&self, langs: &[LangId], now: Ms) -> Vec<Ms> {
        let mut found: Vec<(u64, Ms)> = langs
            .iter()
            .filter_map(|l| self.samples.get(l))
            .flat_map(|q| q.iter())
            .filter(|(_, at, _)| at + self.cfg.estimate_window_ms > now)
            .map(|(id, _, waited)| (*id, *waited))
            .collect();
        // The same wait appears under each shared language; count it once.
        found.sort_unstable();
        found.dedup_by_key(|(id, _)| *id);
        let mut waits: Vec<Ms> = found.into_iter().map(|(_, waited)| waited).collect();
        waits.sort_unstable();
        waits
    }

    fn history_estimate(&self, langs: &[LangId], now: Ms) -> (Bucket, usize) {
        let waits = self.recent_waits(langs, now);
        if waits.len() < self.cfg.estimate_min_samples {
            (Bucket::Unknown, waits.len())
        } else {
            (bucket_of(waits[waits.len() / 2]), waits.len())
        }
    }

    fn estimate_before_joining(&self, langs: &[LangId], now: Ms) -> Estimate {
        let someone_waiting = langs.iter().any(|l| self.lang_waiting.get(l).copied().unwrap_or(0) > 0);
        if someone_waiting {
            return Estimate { bucket: Bucket::UnderAMinute, sample_size: 0, someone_waiting };
        }
        let (bucket, sample_size) = self.history_estimate(langs, now);
        Estimate { bucket, sample_size, someone_waiting }
    }

    fn report_estimates(&mut self, now: Ms, events: &mut Vec<Event>) {
        let mut cache: HashMap<Vec<LangId>, (Bucket, usize)> = HashMap::new();
        let mut waiting: Vec<Uid> = self.slots.iter().filter(|(_, s)| matches!(s, Slot::Waiting(_))).map(|(u, _)| *u).collect();
        waiting.sort_unstable();
        for uid in waiting {
            let Some(Slot::Waiting(w)) = self.slots.get(&uid) else { continue };
            let (mut bucket, sample_size) = match cache.get(&w.cand.langs) {
                Some(hit) => *hit,
                None => {
                    let fresh = self.history_estimate(&w.cand.langs, now);
                    cache.insert(w.cand.langs.clone(), fresh);
                    fresh
                }
            };
            let elapsed = now.saturating_sub(w.cand.seniority);
            if bucket != Bucket::Unknown {
                if elapsed >= 5 * MINUTE {
                    bucket = Bucket::OverFiveMinutes;
                } else if elapsed >= MINUTE && bucket == Bucket::UnderAMinute {
                    bucket = Bucket::AFewMinutes;
                }
            }
            let someone_waiting = w.cand.langs.iter().any(|l| self.lang_waiting.get(l).copied().unwrap_or(0) > 1);
            let estimate = Estimate { bucket, sample_size, someone_waiting };
            // Only a change of bucket is news; the sample count moves after
            // every call and would otherwise message everyone waiting.
            if w.last_estimate.map(|e| e.bucket) != Some(bucket) {
                if let Some(Slot::Waiting(w)) = self.slots.get_mut(&uid) {
                    w.last_estimate = Some(estimate);
                }
                self.push(events, uid, EventKind::Estimate { estimate });
            }
        }
    }
}
