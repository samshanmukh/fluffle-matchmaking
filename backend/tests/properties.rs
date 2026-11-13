//! Randomised tests: thousands of generated queues and command sequences.
//!
//! 1. The fast, indexed selection always returns exactly what the obvious
//!    O(n²) "sort every pair" version returns.
//! 2. Whatever people do, in whatever order, nobody ends up in two places and
//!    nobody is dropped without being told.

use std::collections::{HashMap, HashSet};

use matchmaking::engine::select::{Candidate, Requests, select_indexed, select_naive};
use matchmaking::engine::{Answer, Config, Engine, Event, EventKind, PartnerRequest, Phase};
use proptest::prelude::*;

// ------------------------------------------------------------ 1. selection

fn lang_set() -> impl Strategy<Value = Vec<u32>> {
    // 1 to 5 of 7 languages, skewed so that sets collide often.
    proptest::collection::btree_set(prop_oneof![4 => 0u32..3, 1 => 3u32..7], 1..=5).prop_map(|s| s.into_iter().collect())
}

fn candidates(max: usize) -> impl Strategy<Value = Vec<Candidate>> {
    proptest::collection::vec((lang_set(), proptest::option::weighted(0.6, 0u32..3), 0u64..5), 0..max).prop_map(|rows| {
        rows.into_iter()
            .enumerate()
            .map(|(i, (langs, topic, seniority))| Candidate { uid: i as u32, langs, topic, seniority, seq: i as u64 })
            .collect()
    })
}

fn requests() -> impl Strategy<Value = Vec<(Vec<u32>, Option<u32>)>> {
    proptest::collection::vec((lang_set(), proptest::option::of(0u32..3)), 0..4)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2000))]

    #[test]
    fn indexed_selection_matches_the_reference(
        cands in candidates(40),
        reqs in requests(),
        vetoes in proptest::collection::hash_set((0u32..40, 0u32..40), 0..30),
    ) {
        let reqs = Requests::new(reqs);
        let vetoed = |a: u32, b: u32| vetoes.contains(&(a, b)) || vetoes.contains(&(b, a));
        let fast = select_indexed(&cands, &reqs, &vetoed);
        let slow = select_naive(&cands, &reqs, &vetoed);
        prop_assert_eq!(&fast, &slow);

        // And the result is a valid matching: nobody twice, nobody vetoed, all share a language.
        let mut used = HashSet::new();
        for p in &fast {
            prop_assert!(used.insert(p.older) && used.insert(p.younger), "someone was paired twice");
            prop_assert!(!vetoed(p.older, p.younger));
            prop_assert!(!p.shared.is_empty());
        }
    }
}

// ------------------------------------------------------------ 2. the engine

#[derive(Clone, Debug)]
enum Op {
    Join { user: usize, langs: Vec<u32>, topic: Option<u32> },
    Leave { user: usize },
    Ready { user: usize },
    Decline { user: usize, never_again: bool },
    EndCall { user: usize },
    Block { user: usize, other: usize },
    Tick { advance: u64 },
}

const USERS: usize = 10;

fn op() -> impl Strategy<Value = Op> {
    let user = 0..USERS;
    prop_oneof![
        5 => (user.clone(), lang_set(), proptest::option::weighted(0.5, 0u32..3))
            .prop_map(|(user, langs, topic)| Op::Join { user, langs, topic }),
        1 => user.clone().prop_map(|user| Op::Leave { user }),
        4 => user.clone().prop_map(|user| Op::Ready { user }),
        1 => (user.clone(), any::<bool>()).prop_map(|(user, never_again)| Op::Decline { user, never_again }),
        1 => user.clone().prop_map(|user| Op::EndCall { user }),
        1 => (user.clone(), 0..USERS).prop_map(|(user, other)| Op::Block { user, other }),
        // Mostly short steps, sometimes long enough to expire offers, cooldowns and waits.
        4 => prop_oneof![6 => 1u64..2_000, 2 => 10_000u64..20_000, 1 => 200_000u64..700_000].prop_map(|advance| Op::Tick { advance }),
    ]
}

fn name(u: usize) -> String {
    format!("u{u}")
}

fn apply(e: &mut Engine, op: &Op, now: &mut u64) -> Vec<Event> {
    match op {
        Op::Join { user, langs, topic } => {
            let langs: Vec<String> = langs.iter().map(|l| format!("l{l}")).collect();
            let topic = topic.map(|t| format!("t{t}"));
            let _ = e.join(&name(*user), &langs, topic.as_deref(), *now);
            vec![]
        }
        Op::Leave { user } => e.leave(&name(*user), *now),
        Op::Ready { user } | Op::Decline { user, .. } => {
            let Phase::Offered { match_id } = e.phase(&name(*user)) else { return vec![] };
            let (answer, never_again) = match op {
                Op::Decline { never_again, .. } => (Answer::Decline, *never_again),
                _ => (Answer::Ready, false),
            };
            e.respond(&name(*user), match_id, answer, never_again, *now).unwrap_or_default()
        }
        Op::EndCall { user } => e.end_call(&name(*user), *now).unwrap_or_default(),
        Op::Block { user, other } => e.block(&name(*user), &name(*other), *now).unwrap_or_default(),
        Op::Tick { advance } => {
            *now += advance;
            e.tick(*now)
        }
    }
}

fn requests_for_engine() -> Vec<PartnerRequest> {
    vec![
        PartnerRequest { languages: vec!["l0".into(), "l1".into()], topic: None },
        PartnerRequest { languages: vec!["l0".into()], topic: Some("t1".into()) },
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(1500))]

    #[test]
    fn nobody_is_in_two_places_and_nobody_is_dropped(ops in proptest::collection::vec(op(), 1..120)) {
        let mut engine = Engine::new(Config::default(), &requests_for_engine());
        let mut reference = Engine::new(Config::default(), &requests_for_engine());
        reference.use_reference_selection = true;

        let (mut now, mut ref_now) = (0u64, 0u64);
        // What each user has been told: are they active (queue, offer or call) or back at the start?
        let mut told_active: HashMap<String, bool> = HashMap::new();
        let mut blocked: HashSet<(String, String)> = HashSet::new();

        for op in &ops {
            if let Op::Join { user, .. } = op {
                if engine.phase(&name(*user)) == Phase::Idle {
                    told_active.insert(name(*user), true); // a successful join is acknowledged directly
                }
            }
            if let Op::Block { user, other } = op {
                blocked.insert((name(*user), name(*other)));
            }
            if let Op::Decline { user, never_again: true } = op {
                if let Phase::Offered { .. } = engine.phase(&name(*user)) {
                    // find the partner from the open offer by asking who shares the match
                    for other in 0..USERS {
                        if other != *user && engine.phase(&name(other)) == engine.phase(&name(*user)) {
                            blocked.insert((name(*user), name(other)));
                        }
                    }
                }
            }

            let events = apply(&mut engine, op, &mut now);
            let ref_events = apply(&mut reference, op, &mut ref_now);
            prop_assert_eq!(&events, &ref_events, "indexed and reference engines diverged on {:?}", op);

            for ev in &events {
                match &ev.kind {
                    EventKind::Left { .. } | EventKind::CallEnded { .. } => { told_active.insert(ev.user.clone(), false); }
                    EventKind::Offer { partner, .. } => {
                        prop_assert!(
                            !blocked.contains(&(ev.user.clone(), partner.clone())) && !blocked.contains(&(partner.clone(), ev.user.clone())),
                            "{} was offered blocked user {}", ev.user, partner
                        );
                    }
                    _ => {}
                }
            }

            if let Err(problem) = engine.check_invariants() {
                prop_assert!(false, "after {:?}: {}", op, problem);
            }
            // Nobody is dropped: the engine's view and what the user was told always agree.
            for u in 0..USERS {
                let active = engine.phase(&name(u)) != Phase::Idle;
                let told = told_active.get(&name(u)).copied().unwrap_or(false);
                prop_assert_eq!(active, told, "{} is {:?} but was told active={}", name(u), engine.phase(&name(u)), told);
            }
        }
    }
}
