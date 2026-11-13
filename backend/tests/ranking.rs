//! Who can be paired, and who is paired first (section 2 of the brief).

mod common;
use common::*;
use matchmaking::engine::{EngineError, Phase};

// ---------------------------------------------------------------- eligibility

#[test]
fn people_with_no_shared_language_are_never_paired() {
    let mut e = engine();
    join(&mut e, "ana", &["en"], None, 0);
    join(&mut e, "ben", &["es"], None, 1);
    assert!(pairs(&e.tick(10)).is_empty());
    assert_eq!(e.phase("ana"), Phase::Waiting);
    assert_eq!(e.phase("ben"), Phase::Waiting);
}

#[test]
fn blocked_people_are_never_paired_in_either_direction() {
    let mut e = engine();
    e.block("ben", "ana", 0).unwrap();
    join(&mut e, "ana", &["en"], None, 0);
    join(&mut e, "ben", &["en"], None, 1);
    assert!(pairs(&e.tick(10)).is_empty());
    // A third person pairs with the longer-waiting of the two.
    join(&mut e, "carl", &["en"], None, 20);
    assert_eq!(pairs(&e.tick(30)), ["ana+carl"]);
}

#[test]
fn someone_in_a_pending_offer_is_not_offered_to_anyone_else() {
    let mut e = engine();
    join(&mut e, "ana", &["en"], None, 0);
    join(&mut e, "ben", &["en"], None, 1);
    assert_eq!(pairs(&e.tick(10)), ["ana+ben"]);
    join(&mut e, "carl", &["en"], None, 20);
    assert!(pairs(&e.tick(30)).is_empty(), "ana and ben are busy answering");
    assert_eq!(e.phase("carl"), Phase::Waiting);
}

// ---------------------------------------------------------------- joining

#[test]
fn a_user_joins_with_one_to_five_languages() {
    let mut e = engine();
    assert_eq!(e.join("ana", &[], None, 0), Err(EngineError::NoLanguages));
    let six: Vec<String> = ["a", "b", "c", "d", "e", "f"].iter().map(|s| s.to_string()).collect();
    assert_eq!(e.join("ana", &six, None, 0), Err(EngineError::TooManyLanguages { max: 5 }));
    assert!(e.join("ana", &six[..5], None, 0).is_ok());
}

#[test]
fn a_user_holds_one_place_in_the_queue() {
    let mut e = engine();
    join(&mut e, "ana", &["en"], None, 0);
    assert_eq!(e.join("ana", &["es".to_string()], None, 1), Err(EngineError::AlreadyActive));
    assert_eq!(e.stats().waiting, 1);
}

#[test]
fn languages_are_compared_ignoring_case_spacing_and_repeats() {
    let mut e = engine();
    join(&mut e, "ana", &["English", " english ", "ES"], None, 0); // two languages, not three
    join(&mut e, "ben", &["ENGLISH", "es"], None, 1);
    let made = offers(&e.tick(10));
    assert_eq!(made.len(), 1);
    assert_eq!(made[0].1, ["english", "es"]);
}

// ---------------------------------------------------------------- rule 1: exact set first

#[test]
fn the_exact_same_language_set_is_paired_before_an_overlap() {
    let mut e = engine();
    join(&mut e, "ana", &["en"], None, 0);
    join(&mut e, "bea", &["en", "es"], None, 1); // overlaps with ana, joined before carl
    join(&mut e, "carl", &["en"], None, 2); // exact match for ana
    assert_eq!(pairs(&e.tick(10)), ["ana+carl"]);
    assert_eq!(e.phase("bea"), Phase::Waiting);
}

#[test]
fn a_partial_overlap_is_paired_when_no_exact_match_exists() {
    let mut e = engine();
    join(&mut e, "ana", &["en"], None, 0);
    join(&mut e, "bea", &["en", "es"], None, 1);
    let made = offers(&e.tick(10));
    assert_eq!(made.len(), 1);
    assert_eq!(made[0].1, ["en"], "the call is labelled with the languages they share");
}

#[test]
fn the_call_is_labelled_with_every_shared_language() {
    let mut e = engine();
    join(&mut e, "ana", &["en", "es", "fr"], None, 0);
    join(&mut e, "bea", &["es", "en", "de"], None, 1);
    assert_eq!(offers(&e.tick(10))[0].1, ["en", "es"]);
}

// ---------------------------------------------------------------- rule 2: partner request

#[test]
fn a_partner_request_for_the_shared_languages_beats_a_longer_wait() {
    // carl has waited longest and overlaps with ana on French only.
    let setup = |e: &mut matchmaking::engine::Engine| {
        join(e, "carl", &["fr", "it"], None, 0);
        join(e, "ana", &["en", "es", "fr"], None, 2);
        join(e, "bea", &["en", "es", "de"], None, 3);
    };
    let mut without = engine();
    setup(&mut without);
    assert_eq!(pairs(&without.tick(10)), ["ana+carl"], "no request: longest wait wins");

    let mut with = engine_with(&[(&["en", "es"], None)]);
    setup(&mut with);
    assert_eq!(pairs(&with.tick(10)), ["ana+bea"], "request for en+es: that pair goes first");
}

#[test]
fn a_request_naming_a_topic_both_picked_ranks_higher_still() {
    let mut e = engine_with(&[(&["en"], Some("politics"))]);
    join(&mut e, "carl", &["en"], None, 0); // longest wait, no topic
    join(&mut e, "ana", &["en"], Some("politics"), 5);
    join(&mut e, "bea", &["en"], Some("politics"), 6);
    assert_eq!(pairs(&e.tick(10)), ["ana+bea"]);
    assert_eq!(e.phase("carl"), Phase::Waiting);
}

#[test]
fn a_partner_request_outranks_a_shared_topic() {
    let mut e = engine_with(&[(&["en", "es"], None)]);
    // dan overlaps with ana on en+es (requested), and with eve on fr with a shared topic.
    join(&mut e, "eve", &["fr", "it"], Some("music"), 0);
    join(&mut e, "dan", &["en", "es", "fr"], Some("music"), 1);
    join(&mut e, "ana", &["en", "es", "de"], None, 2);
    assert_eq!(pairs(&e.tick(10)), ["ana+dan"]);
}

// ---------------------------------------------------------------- rule 2 cont.: topic, then wait

#[test]
fn a_shared_topic_beats_a_longer_wait() {
    let mut e = engine();
    join(&mut e, "finn", &["en"], None, 0); // waited longest
    join(&mut e, "ana", &["en"], Some("sports"), 20);
    join(&mut e, "ben", &["en"], Some("sports"), 35);
    let made = offers(&e.tick(60));
    assert_eq!(made.len(), 1);
    assert_eq!(made[0].0, ("ana".to_string(), "ben".to_string()));
    assert_eq!(made[0].2.as_deref(), Some("sports"), "that prompt is used on the call");
    assert_eq!(e.phase("finn"), Phase::Waiting);
}

#[test]
fn with_everything_else_equal_the_longest_wait_is_paired_first() {
    let mut e = engine();
    join(&mut e, "new1", &["en"], None, 50);
    join(&mut e, "old", &["en"], None, 0);
    join(&mut e, "new2", &["en"], None, 40);
    // old (0) pairs with the next-longest waiter (new2 at 40); new1 keeps waiting.
    assert_eq!(pairs(&e.tick(60)), ["new2+old"]);
    assert_eq!(e.phase("new1"), Phase::Waiting);
}

#[test]
fn an_exact_tie_on_wait_goes_to_whoever_reached_the_server_first() {
    let mut e = engine();
    join(&mut e, "carl", &["en"], Some("sports"), 0);
    // ana and ben rejoin in the same millisecond; ana's request is handled first.
    join(&mut e, "ana", &["en"], Some("sports"), 100);
    join(&mut e, "ben", &["en"], Some("sports"), 100);
    assert_eq!(pairs(&e.tick(110)), ["ana+carl"]);
    assert_eq!(e.phase("ben"), Phase::Waiting);
}

// ---------------------------------------------------------------- rule 3: topic is a preference

#[test]
fn different_topics_still_match_with_no_agreed_topic() {
    let mut e = engine();
    join(&mut e, "ana", &["en"], Some("sports"), 0);
    join(&mut e, "ben", &["en"], Some("music"), 1);
    let made = offers(&e.tick(10));
    assert_eq!(made.len(), 1);
    assert_eq!(made[0].2, None);
}

#[test]
fn a_topic_on_only_one_side_still_matches_with_no_agreed_topic() {
    let mut e = engine();
    join(&mut e, "ana", &["en"], Some("sports"), 0);
    join(&mut e, "ben", &["en"], None, 1);
    let made = offers(&e.tick(10));
    assert_eq!(made.len(), 1);
    assert_eq!(made[0].2, None);
}

// ---------------------------------------------------------------- the full order in one scene

#[test]
fn the_explainer_video_scenario_plays_out_as_drawn() {
    let mut e = engine_with(&[(&["en", "es"], None)]);
    join(&mut e, "finn", &["en"], None, 0);
    join(&mut e, "chloe", &["en", "es"], Some("music"), 10);
    join(&mut e, "ana", &["en"], Some("sports"), 20);
    join(&mut e, "emi", &["en", "fr"], Some("travel"), 30);
    join(&mut e, "ben", &["en"], Some("sports"), 35);
    join(&mut e, "dev", &["en", "es"], Some("politics"), 50);
    join(&mut e, "gus", &["fr"], None, 55);
    // Offers are made best-first: partner request, shared topic, then the overlap by longest wait.
    assert_eq!(pairs(&e.tick(60)), ["chloe+dev", "ana+ben", "emi+finn"]);
    assert_eq!(e.phase("gus"), Phase::Waiting);
}
