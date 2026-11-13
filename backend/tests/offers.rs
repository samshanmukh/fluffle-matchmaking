//! What happens to a match offer, the wait budget, and the wait estimate.

mod common;
use common::*;
use matchmaking::engine::{Answer, Bucket, CallEndReason, Config, Engine, EngineError, EventKind, LeftReason, Phase, RequeueReason};

const OFFER: u64 = 15_000;
const BUDGET: u64 = 600_000;

/// ana (joined at 0) and ben (joined at 1) with an offer opened at t=10.
fn offered() -> Engine {
    let mut e = engine();
    join(&mut e, "ana", &["en"], Some("sports"), 0);
    join(&mut e, "ben", &["en"], Some("sports"), 1);
    assert_eq!(pairs(&e.tick(10)), ["ana+ben"]);
    e
}

// ---------------------------------------------------------------- the offer

#[test]
fn both_people_see_the_offer_at_the_same_time_with_the_same_window() {
    let mut e = engine();
    join(&mut e, "ana", &["en"], None, 0);
    join(&mut e, "ben", &["en"], None, 1);
    let events = e.tick(10);
    for (me, partner) in [("ana", "ben"), ("ben", "ana")] {
        let mine = kinds_for(&events, me);
        assert!(
            mine.iter().any(|k| matches!(k, EventKind::Offer { partner: p, expires_in_ms, .. } if p == partner && *expires_in_ms == OFFER)),
            "{me} should be shown {partner}"
        );
    }
}

#[test]
fn the_call_starts_only_when_both_say_ready() {
    let mut e = offered();
    let first = ready(&mut e, "ana", 1_000);
    assert!(first.is_empty(), "one ready is not enough");
    assert!(matches!(e.phase("ana"), Phase::Offered { .. }));

    let second = ready(&mut e, "ben", 2_000);
    for user in ["ana", "ben"] {
        assert!(matches!(e.phase(user), Phase::InCall { .. }));
        assert!(kinds_for(&second, user).iter().any(|k| matches!(
            k,
            EventKind::CallStarted { languages, topic, .. } if languages == &["en"] && topic.as_deref() == Some("sports")
        )));
    }
}

#[test]
fn saying_ready_twice_changes_nothing() {
    let mut e = offered();
    ready(&mut e, "ana", 1_000);
    assert!(ready(&mut e, "ana", 1_500).is_empty());
    assert!(matches!(e.phase("ana"), Phase::Offered { .. }));
}

#[test]
fn a_decline_removes_the_decliner_and_requeues_the_other_at_once() {
    let mut e = offered();
    let events = decline(&mut e, "ben", false, 3_000);
    assert_eq!(kinds_for(&events, "ben"), [&EventKind::Left { reason: LeftReason::Declined }]);
    assert_eq!(
        kinds_for(&events, "ana"),
        [&EventKind::Requeued { reason: RequeueReason::PartnerDeclined, wait_budget_ms: BUDGET }]
    );
    assert_eq!(e.phase("ben"), Phase::Idle);
    assert_eq!(e.phase("ana"), Phase::Waiting);
}

#[test]
fn the_requeued_person_keeps_their_place_at_the_front() {
    let mut e = offered(); // ana has been here since t=0, and is answering an offer with ben
    // Two people arrive while ana is busy. No pass runs, so both are still waiting.
    join(&mut e, "carl", &["en"], Some("sports"), 2_000);
    join(&mut e, "dana", &["en"], Some("sports"), 3_000);
    decline(&mut e, "ben", false, 4_000); // ana is requeued at t=4000
    // With her place kept (t=0) ana is first and pairs with carl, the next longest waiter.
    // Had requeueing reset her place to t=4000, carl and dana would pair and ana would wait.
    assert_eq!(pairs(&e.tick(5_000)), ["ana+carl"]);
    assert_eq!(e.phase("dana"), Phase::Waiting);
}

#[test]
fn the_requeued_person_gets_a_fresh_wait_budget() {
    let mut e = offered();
    decline(&mut e, "ben", false, 5_000);
    // ana joined at 0; her original budget would end at 600 000.
    assert!(e.tick(BUDGET + 1).iter().all(|ev| ev.user != "ana" || !matches!(ev.kind, EventKind::Left { .. })));
    assert_eq!(e.phase("ana"), Phase::Waiting);
    let events = e.tick(5_000 + BUDGET);
    assert_eq!(kinds_for(&events, "ana"), [&EventKind::Left { reason: LeftReason::WaitTimeout }]);
}

#[test]
fn when_one_person_does_not_answer_they_leave_and_the_other_is_requeued() {
    let mut e = offered();
    ready(&mut e, "ana", 2_000);
    let events = e.tick(10 + OFFER);
    assert_eq!(kinds_for(&events, "ben"), [&EventKind::Left { reason: LeftReason::OfferTimeout }]);
    assert!(kinds_for(&events, "ana").contains(&&EventKind::Requeued { reason: RequeueReason::PartnerTimedOut, wait_budget_ms: BUDGET }));
    assert_eq!(e.phase("ben"), Phase::Idle);
    assert_eq!(e.phase("ana"), Phase::Waiting);
}

#[test]
fn when_neither_answers_both_leave() {
    let mut e = offered();
    assert!(e.tick(10 + OFFER - 1).is_empty(), "the window is still open");
    let events = e.tick(10 + OFFER);
    for user in ["ana", "ben"] {
        assert_eq!(kinds_for(&events, user), [&EventKind::Left { reason: LeftReason::OfferTimeout }]);
        assert_eq!(e.phase(user), Phase::Idle);
    }
}

#[test]
fn an_answer_after_the_window_closed_does_not_start_a_call() {
    let mut e = offered();
    ready(&mut e, "ana", 2_000);
    // ben answers late, before the next pass has run.
    let id = match_id(&e, "ben");
    let events = e.respond("ben", id, Answer::Ready, false, 10 + OFFER + 5).unwrap();
    assert!(events.iter().all(|ev| !matches!(ev.kind, EventKind::CallStarted { .. })));
    assert_eq!(e.phase("ben"), Phase::Idle);
    assert_eq!(e.phase("ana"), Phase::Waiting);
}

#[test]
fn answering_an_offer_that_is_not_yours_is_rejected() {
    let mut e = offered();
    let id = match_id(&e, "ana");
    join(&mut e, "carl", &["en"], None, 20);
    assert_eq!(e.respond("carl", id, Answer::Ready, false, 30), Err(EngineError::NoSuchOffer));
    assert_eq!(e.respond("ana", id + 99, Answer::Ready, false, 30), Err(EngineError::NoSuchOffer));
}

#[test]
fn leaving_during_an_offer_counts_as_a_decline() {
    let mut e = offered();
    let events = e.leave("ben", 1_000);
    assert_eq!(kinds_for(&events, "ben"), [&EventKind::Left { reason: LeftReason::Cancelled }]);
    assert_eq!(e.phase("ana"), Phase::Waiting);
}

// ---------------------------------------------------------------- don't match me again

#[test]
fn dont_match_me_again_is_permanent() {
    let mut e = offered();
    decline(&mut e, "ben", true, 1_000);
    join(&mut e, "ben", &["en"], Some("sports"), 2_000);
    assert!(pairs(&e.tick(3_000)).is_empty());
    // Still true long after any cooldown.
    e.leave("ana", 4_000);
    e.leave("ben", 4_000);
    join(&mut e, "ana", &["en"], None, 10_000_000);
    join(&mut e, "ben", &["en"], None, 10_000_001);
    assert!(pairs(&e.tick(10_000_010)).is_empty());
}

#[test]
fn a_plain_decline_only_keeps_the_two_apart_for_a_while() {
    let mut e = offered();
    decline(&mut e, "ben", false, 1_000);
    join(&mut e, "ben", &["en"], Some("sports"), 2_000);
    assert!(pairs(&e.tick(3_000)).is_empty(), "not offered to each other straight away");
    let cooldown = Config::default().decline_cooldown_ms;
    assert_eq!(pairs(&e.tick(1_000 + cooldown)), ["ana+ben"]);
}

#[test]
fn blocking_someone_during_an_open_offer_closes_it() {
    let mut e = offered();
    let events = e.block("ana", "ben", 1_000).unwrap();
    assert_eq!(kinds_for(&events, "ana"), [&EventKind::Left { reason: LeftReason::Declined }]);
    assert_eq!(e.phase("ana"), Phase::Idle);
    assert_eq!(e.phase("ben"), Phase::Waiting);
}

// ---------------------------------------------------------------- after the call

fn in_call() -> Engine {
    let mut e = offered();
    ready(&mut e, "ana", 1_000);
    ready(&mut e, "ben", 1_000);
    e
}

#[test]
fn ending_a_call_frees_both_people_and_tells_the_partner() {
    let mut e = in_call();
    let events = e.end_call("ana", 60_000).unwrap();
    assert!(matches!(kinds_for(&events, "ana")[0], EventKind::CallEnded { reason: CallEndReason::YouEnded, .. }));
    assert!(matches!(kinds_for(&events, "ben")[0], EventKind::CallEnded { reason: CallEndReason::PartnerLeft, .. }));
    assert_eq!(e.phase("ana"), Phase::Idle);
    assert_eq!(e.phase("ben"), Phase::Idle);
    assert_eq!(e.end_call("ana", 60_001), Err(EngineError::NotInCall));
}

#[test]
fn two_people_who_just_talked_are_not_offered_each_other_again() {
    // ana and ben share en+es exactly; carl only overlaps. Without the
    // cooldown, exact-set-first would pair ana with ben again and starve carl.
    let mut e = engine();
    join(&mut e, "ana", &["en", "es"], None, 0);
    join(&mut e, "ben", &["en", "es"], None, 1);
    e.tick(10);
    ready(&mut e, "ana", 20);
    ready(&mut e, "ben", 20);
    join(&mut e, "carl", &["en"], None, 30);
    e.end_call("ana", 60_000).unwrap();
    join(&mut e, "ana", &["en", "es"], None, 61_000);
    join(&mut e, "ben", &["en", "es"], None, 61_500);
    // carl has waited longest; ana rejoined before ben.
    assert_eq!(pairs(&e.tick(62_000)), ["ana+carl"]);
    assert_eq!(e.phase("ben"), Phase::Waiting);
}

#[test]
fn recent_partners_can_be_paired_again_after_the_cooldown() {
    let mut e = in_call();
    e.end_call("ana", 60_000).unwrap();
    join(&mut e, "ana", &["en"], None, 61_000);
    join(&mut e, "ben", &["en"], None, 61_000);
    assert!(pairs(&e.tick(62_000)).is_empty());
    let cooldown = Config::default().recent_partner_cooldown_ms;
    assert_eq!(pairs(&e.tick(60_000 + cooldown)), ["ana+ben"]);
}

// ---------------------------------------------------------------- waiting and leaving

#[test]
fn a_user_can_leave_at_any_time_while_waiting() {
    let mut e = engine();
    join(&mut e, "ana", &["en"], None, 0);
    let events = e.leave("ana", 500);
    assert_eq!(kinds_for(&events, "ana"), [&EventKind::Left { reason: LeftReason::Cancelled }]);
    assert_eq!(e.phase("ana"), Phase::Idle);
    join(&mut e, "ben", &["en"], None, 600);
    assert!(pairs(&e.tick(700)).is_empty(), "ana is gone, so ben has nobody");
}

#[test]
fn a_user_who_waits_the_whole_budget_is_told_and_returned_to_the_start() {
    let mut e = engine();
    join(&mut e, "ana", &["en"], None, 0);
    assert!(e.tick(BUDGET - 1).iter().all(|ev| !matches!(ev.kind, EventKind::Left { .. })));
    let events = e.tick(BUDGET);
    assert_eq!(kinds_for(&events, "ana"), [&EventKind::Left { reason: LeftReason::WaitTimeout }]);
    assert_eq!(e.phase("ana"), Phase::Idle);
    assert!(e.join("ana", &["en".to_string()], None, BUDGET + 1).is_ok(), "they can start again");
}

// ---------------------------------------------------------------- wait estimate

fn langs(l: &[&str]) -> Vec<String> {
    l.iter().map(|s| s.to_string()).collect()
}

/// Runs one complete match in `lang` where both people waited about `waited` ms.
fn complete_a_match(e: &mut Engine, tag: &str, lang: &str, at: u64, waited: u64) {
    let (a, b) = (format!("{tag}-a"), format!("{tag}-b"));
    join(e, &a, &[lang], None, at);
    join(e, &b, &[lang], None, at);
    e.tick(at + waited);
    ready(e, &a, at + waited);
    ready(e, &b, at + waited);
    e.end_call(&a, at + waited + 1).unwrap();
}

#[test]
fn with_no_data_the_estimate_is_hidden() {
    let e = engine();
    let est = e.estimate(&langs(&["en"]), 0);
    assert_eq!(est.bucket, Bucket::Unknown);
    assert!(!est.someone_waiting);
}

#[test]
fn if_someone_compatible_is_waiting_the_estimate_is_under_a_minute() {
    let mut e = engine();
    join(&mut e, "ana", &["en", "es"], None, 0);
    assert_eq!(e.estimate(&langs(&["es"]), 10).bucket, Bucket::UnderAMinute);
    assert_eq!(e.estimate(&langs(&["fr"]), 10).bucket, Bucket::Unknown, "nobody speaks French");
    e.leave("ana", 20);
    assert_eq!(e.estimate(&langs(&["es"]), 30).bucket, Bucket::Unknown, "updates when people leave");
}

#[test]
fn the_estimate_is_the_median_of_recent_real_waits_once_there_are_enough() {
    let mut e = engine();
    complete_a_match(&mut e, "m1", "en", 0, 120_000);
    assert_eq!(e.estimate(&langs(&["en"]), 130_000).bucket, Bucket::Unknown, "two samples are not enough");
    complete_a_match(&mut e, "m2", "en", 200_000, 150_000);
    let est = e.estimate(&langs(&["en"]), 400_000);
    assert_eq!(est.bucket, Bucket::AFewMinutes);
    assert_eq!(est.sample_size, 4);
    assert_eq!(e.estimate(&langs(&["fr"]), 400_000).bucket, Bucket::Unknown, "other languages have no data");
}

#[test]
fn a_match_in_two_languages_counts_each_persons_wait_once() {
    let mut e = engine();
    join(&mut e, "ana", &["en", "es"], None, 0);
    join(&mut e, "ben", &["en", "es"], None, 0);
    e.tick(10_000);
    ready(&mut e, "ana", 10_000);
    ready(&mut e, "ben", 10_000);
    // One call, two people: two samples, even when asking about both languages.
    let est = e.estimate(&langs(&["en", "es"]), 20_000);
    assert_eq!(est.sample_size, 2);
    assert_eq!(est.bucket, Bucket::Unknown, "one match is not enough to quote a wait");
}

#[test]
fn other_peoples_calls_do_not_trigger_estimate_messages_unless_the_bucket_changes() {
    let mut e = engine();
    complete_a_match(&mut e, "m1", "en", 0, 10_000);
    complete_a_match(&mut e, "m2", "en", 20_000, 10_000);
    e.block("zoe", "m3-a", 0).unwrap();
    e.block("zoe", "m3-b", 0).unwrap();
    e.join("zoe", &langs(&["en"]), None, 40_000).unwrap(); // told "under a minute" on joining
    // Another quick match completes: more samples, same bucket.
    complete_a_match(&mut e, "m3", "en", 41_000, 5_000);
    let events = e.tick(47_000);
    assert!(events.iter().all(|ev| ev.user != "zoe"), "zoe was messaged although nothing she sees changed: {events:?}");
}

#[test]
fn old_waits_stop_counting() {
    let mut e = engine();
    complete_a_match(&mut e, "m1", "en", 0, 10_000);
    complete_a_match(&mut e, "m2", "en", 20_000, 10_000);
    assert_eq!(e.estimate(&langs(&["en"]), 40_000).bucket, Bucket::UnderAMinute);
    let window = Config::default().estimate_window_ms;
    assert_eq!(e.estimate(&langs(&["en"]), 40_000 + window).bucket, Bucket::Unknown);
}

#[test]
fn while_waiting_the_estimate_never_claims_less_than_the_time_already_waited() {
    let mut e = engine();
    complete_a_match(&mut e, "m1", "en", 0, 10_000);
    complete_a_match(&mut e, "m2", "en", 20_000, 10_000); // history says "under a minute"
    let on_join = e.join("zoe", &langs(&["en"]), None, 40_000).unwrap();
    assert_eq!(on_join.bucket, Bucket::UnderAMinute);

    let estimate_sent = |events: &[matchmaking::engine::Event]| {
        events.iter().find_map(|ev| match (&ev.kind, ev.user.as_str()) {
            (EventKind::Estimate { estimate }, "zoe") => Some(estimate.bucket),
            _ => None,
        })
    };
    assert_eq!(estimate_sent(&e.tick(41_000)), None, "nothing is sent when nothing changed");
    assert_eq!(estimate_sent(&e.tick(40_000 + 61_000)), Some(Bucket::AFewMinutes));
    assert_eq!(estimate_sent(&e.tick(40_000 + 301_000)), Some(Bucket::OverFiveMinutes));
}
